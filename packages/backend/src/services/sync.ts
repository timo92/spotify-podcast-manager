import { randomUUID } from 'node:crypto';
import { StatusCodes } from 'http-status-codes';
import {
  guessCategories,
  guessMode,
  inSyncWindow,
  syncCutoff,
  truncate,
  type Episode,
  type Settings,
  type Show,
  type SyncState,
} from '@podcast/shared';
import { ApiError } from '../errors.js';
import type { SpotifyApi, SpotifyEpisode, SpotifyImage, SpotifyShow } from '../spotify/types.js';
import type { Store } from '../store/types.js';
import { LibraryService, mapLimit } from './library.js';
import { PlanService } from './plan.js';
import { applyRetention } from './retention.js';
import { UpNextService } from './up-next.js';

export interface SyncOptions {
  /** Re-import all episodes of every show (otherwise only new ones). */
  full?: boolean;
  /** Only sync this show (always a full re-import). */
  showId?: string;
  /** Lease the API acquired for this run (see acquireSyncLease); the run takes it over. */
  leaseId?: string;
}

/**
 * A sync that has been "running" for longer than this is considered dead, and
 * its lease free (the sync Lambda times out after 15 minutes).
 */
export const STALE_SYNC_MS = 16 * 60 * 1000;

/**
 * The sync state as the UI should see it: a sync still "running" after
 * STALE_SYNC_MS died without finishing (Lambda timeout or crash). Reported as
 * interrupted, so the UI doesn't wait for it; the next sync takes the lease over.
 */
export function visibleSyncState(state: SyncState): SyncState {
  if (state.status !== 'running' || !state.startedAt) return state;
  if (Date.parse(state.startedAt) > Date.now() - STALE_SYNC_MS) return state;
  return endedState(
    state,
    new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, 'sync_interrupted', 'Der letzte Sync wurde unterbrochen.'),
  );
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** `state` without its lease: idle, or failed with `error` (an ApiError keeps its code for the UI). */
function endedState(state: SyncState, error?: unknown): SyncState {
  const failed = error !== undefined;
  return {
    ...state,
    status: failed ? 'error' : 'idle',
    error: failed ? messageOf(error) : undefined,
    errorCode: error instanceof ApiError ? error.code : undefined,
    errorParams: error instanceof ApiError ? error.params : undefined,
    showId: undefined,
    message: undefined,
    leaseId: undefined,
  };
}

/**
 * Starts a sync lease: only one sync may run at a time, enforced by a
 * conditional write in the store rather than by Lambda reserved concurrency
 * (which new AWS accounts can't spare). Returns the state it wrote (with the
 * lease id), or undefined if another sync holds an unexpired lease.
 *
 * A takeover always switches to a new lease id: async Lambda invocations are
 * delivered at least once, and only the first delivery of a duplicate may
 * match `takeOver`.
 */
export async function acquireSyncLease(
  store: Store,
  fields: Pick<SyncState, 'message' | 'showId'>,
  takeOver?: string,
  now = new Date(),
): Promise<(SyncState & { leaseId: string }) | undefined> {
  const prev = await store.getSyncState();
  const state = {
    ...prev,
    ...fields,
    showId: fields.showId,
    status: 'running' as const,
    startedAt: now.toISOString(),
    error: undefined,
    errorCode: undefined,
    errorParams: undefined,
    leaseId: randomUUID(),
  };
  const acquired = await store.acquireSyncLease(state, new Date(now.getTime() - STALE_SYNC_MS).toISOString(), takeOver);
  return acquired ? state : undefined;
}

/**
 * Starts syncs on request (button, login): acquires the lease here, so the UI
 * shows "running" immediately and a second click can't start a parallel sync,
 * then hands it to the run (`trigger`: async Lambda invocation, or in-process
 * locally).
 */
export class SyncLauncher {
  constructor(
    private readonly store: Store,
    private readonly trigger: (opts: SyncOptions) => Promise<void>,
  ) {}

  /** The running sync's state; the one already running if another holds the lease. */
  async start(opts: SyncOptions): Promise<SyncState> {
    const lease = await acquireSyncLease(this.store, { message: 'Gestartet…', showId: opts.showId });
    if (!lease) return this.store.getSyncState();
    try {
      await this.trigger({ ...opts, leaseId: lease.leaseId });
    } catch (e) {
      console.error('Sync could not be started', e);
      // Nothing will run under this lease, so free it instead of blocking syncs.
      const failure = new ApiError(StatusCodes.BAD_GATEWAY, 'sync_start_failed', 'Sync konnte nicht gestartet werden.');
      await releaseSyncLease(this.store, lease, failure);
      throw failure;
    }
    return lease;
  }
}

/** Ends a lease without a sync result, e.g. when the triggered run could not start. */
export async function releaseSyncLease(store: Store, lease: SyncState & { leaseId: string }, error?: unknown) {
  await store.releaseSyncLease(lease.leaseId, { ...endedState(lease, error), finishedAt: new Date().toISOString() });
}

/**
 * Re-reads a stored episode from Spotify; returns the new version only if it
 * changed (resume point, metadata), undefined otherwise.
 */
export async function refetchEpisode(spotify: SpotifyApi, stored: Episode, now: string): Promise<Episode | undefined> {
  const fresh = await spotify.getEpisode(stored.id);
  if (!fresh) return undefined;
  const episode = toEpisode(fresh, stored.showId, stored, now);
  return episodeChanged(stored, episode) ? episode : undefined;
}

export function pickImage(images: SpotifyImage[] | undefined): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => Math.abs((a.width ?? 300) - 300) - Math.abs((b.width ?? 300) - 300));
  return sorted[0]?.url;
}

/**
 * The episode as Spotify reports it now. What the app recorded itself (first
 * seen, listing order, when it saw the episode finished) is carried over from
 * `prev`, the stored version.
 */
export function toEpisode(raw: SpotifyEpisode, showId: string, prev: Episode | undefined, now: string): Episode {
  const fullyPlayed = raw.resume_point?.fully_played === true;
  return {
    id: raw.id,
    showId,
    name: raw.name,
    description: truncate((raw.description ?? '').trim(), 2000),
    releaseDate: raw.release_date,
    durationMs: raw.duration_ms,
    imageUrl: pickImage(raw.images),
    spotifyUrl: raw.external_urls?.spotify ?? `https://open.spotify.com/episode/${raw.id}`,
    explicit: raw.explicit,
    isPlayable: raw.is_playable,
    resumePoint: raw.resume_point
      ? { fullyPlayed: raw.resume_point.fully_played, resumePositionMs: raw.resume_point.resume_position_ms }
      : undefined,
    listingOrder: prev?.listingOrder,
    fullyPlayedSeenAt: fullyPlayed
      ? (prev?.fullyPlayedSeenAt ?? (prev && !prev.resumePoint?.fullyPlayed ? now : undefined))
      : undefined,
    firstSeenAt: prev?.firstSeenAt ?? now,
    lastSyncedAt: now,
  };
}

/**
 * Gives the fetched episodes (Spotify's listing, newest first) their
 * `listingOrder`. Known episodes keep theirs; the others are numbered oldest
 * first on top of the highest known one, so the new episodes an incremental
 * sync finds come after the stored ones.
 */
export function withListingOrder(fetched: Episode[], known: Map<string, Episode>): Episode[] {
  let next = 1 + [...known.values()].reduce((max, e) => Math.max(max, e.listingOrder ?? -1), -1);
  return fetched
    .toReversed()
    .map((e) => ({ ...e, listingOrder: e.listingOrder ?? next++ }))
    .toReversed();
}

/** Whether a fetched episode differs from the stored one in anything the sync stores. */
export function episodeChanged(prev: Episode | undefined, next: Episode): boolean {
  if (!prev) return true;
  return (
    prev.name !== next.name ||
    prev.description !== next.description ||
    prev.releaseDate !== next.releaseDate ||
    prev.durationMs !== next.durationMs ||
    prev.imageUrl !== next.imageUrl ||
    prev.isPlayable !== next.isPlayable ||
    prev.listingOrder !== next.listingOrder ||
    prev.fullyPlayedSeenAt !== next.fullyPlayedSeenAt ||
    prev.resumePoint?.fullyPlayed !== next.resumePoint?.fullyPlayed ||
    prev.resumePoint?.resumePositionMs !== next.resumePoint?.resumePositionMs
  );
}

/**
 * Imports shows and episodes from Spotify. Only touches metadata – personal
 * progress lives in separate items and is never written here, so a sync can
 * be repeated any number of times (idempotent).
 */
export class SyncService {
  private readonly library: LibraryService;

  constructor(
    private readonly store: Store,
    private readonly spotify: SpotifyApi,
  ) {
    this.library = new LibraryService(store);
  }

  /** Runs a sync, or returns the current state unchanged if another sync holds the lease. */
  async run(opts: SyncOptions = {}): Promise<SyncState> {
    const message = opts.showId ? 'Podcast wird neu geladen…' : 'Synchronisiere mit Spotify…';
    const lease = await acquireSyncLease(this.store, { message, showId: opts.showId }, opts.leaseId);
    if (!lease) return this.store.getSyncState();
    const { leaseId, startedAt } = lease;
    let state: SyncState;
    try {
      const result = opts.showId ? await this.syncSingle(opts.showId) : await this.syncAll(!!opts.full);
      const finishedAt = new Date().toISOString();
      state = {
        status: 'idle',
        startedAt,
        finishedAt,
        lastSuccessAt: finishedAt,
        showsSynced: result.shows,
        showsFailed: result.failed,
        newEpisodes: result.newEpisodes,
        message:
          result.failed > 0
            ? `${result.shows} Podcasts synchronisiert, ${result.failed} mit Fehlern.`
            : `${result.shows} Podcasts synchronisiert, ${result.newEpisodes} neue Folgen.`,
      };
    } catch (e) {
      state = { ...endedState(lease, e), finishedAt: new Date().toISOString() };
    }
    // Retention is housekeeping: it runs after a library sync (not after a
    // single-show reload), and a failure there must not turn a successful sync
    // into an error.
    if (!opts.showId && state.status === 'idle') {
      try {
        await applyRetention(this.store);
      } catch (e) {
        console.error('Retention failed', e);
      }
    }
    // If the lease expired meanwhile and another sync took over, leave its state alone.
    await this.store.releaseSyncLease(leaseId, state);
    // New episodes join the "Up next" playlist, also while the web app is closed.
    if (state.status === 'idle') {
      const planner = new PlanService(this.store, this.library);
      await new UpNextService(this.store, planner, () => this.spotify).refreshQuietly();
    }
    return state;
  }

  private async syncAll(full: boolean) {
    const [saved, existingList, settings] = await Promise.all([
      this.spotify.getSavedShows(),
      this.store.listShows(),
      this.store.getSettings(),
    ]);
    const existing = new Map(existingList.map((s) => [s.id, s]));
    const listed = new Set(saved.map((s) => s.id));
    const now = new Date().toISOString();

    // The library listing skips entries Spotify returns without show data (e.g.
    // taken down), so a known show missing from it is only a candidate: ask
    // Spotify directly. If that check fails, nothing is unfollowed this time.
    const missing = existingList.filter((s) => !listed.has(s.id)).map((s) => s.id);
    let inLibrary = new Map<string, boolean>();
    if (missing.length) {
      try {
        inLibrary = await this.spotify.libraryContains(missing);
      } catch (e) {
        console.error('Could not check the library for missing shows', e);
        inLibrary = new Map(missing.map((id) => [id, true]));
      }
    }
    const isSaved = (id: string) => listed.has(id) || inLibrary.get(id) === true;

    // Shows in the library count as followed right away, independent of whether
    // their episode sync below succeeds – otherwise retention could delete a
    // show the user follows.
    for (const show of existingList) {
      if (isSaved(show.id) && (!show.followed || show.unfollowedAt)) {
        await this.store.updateShow(show.id, { followed: true, unfollowedAt: undefined });
      }
    }

    // Shows removed from the Spotify library are kept (with their progress)
    // but no longer suggested, and deleted after RETENTION_DAYS (retention.ts).
    for (const show of existingList) {
      if (isSaved(show.id)) continue;
      if (show.followed) {
        await this.store.updateShow(show.id, { followed: false, unfollowedAt: now });
        await this.library.recompute(show.id, settings);
      } else if (!show.unfollowedAt) {
        await this.store.updateShow(show.id, { unfollowedAt: now });
      }
    }

    const basePriority = existingList.reduce((m, s) => Math.max(m, s.priority), 0);
    let maxPriority = basePriority;
    const provisional = new Map<string, number>();
    const nextPriority = (showId: string) => {
      provisional.set(showId, ++maxPriority);
      return maxPriority;
    };
    let newEpisodes = 0;
    let failed = 0;
    let lastError: unknown;
    await mapLimit(saved, 3, async (raw) => {
      try {
        // Await first: `+=` would read the total before the await and lose the other workers' counts.
        const added = await this.syncShow(raw.id, raw, existing.get(raw.id), full, settings, nextPriority);
        newEpisodes += added;
      } catch (e) {
        // Auth problems affect every show – abort instead of failing 50 times.
        if (e instanceof ApiError && (e.status === StatusCodes.UNAUTHORIZED || e.code === 'spotify_rate_limited'))
          throw e;
        failed++;
        lastError = e;
        if (existing.has(raw.id)) {
          await this.store.updateShow(raw.id, { lastSyncError: e instanceof Error ? e.message : String(e) });
        }
      }
    });
    if (failed > 0 && failed === saved.length) throw lastError;

    // Newly imported shows: news-like ones first (time-sensitive), then by name.
    // A show the user has already moved during the import keeps its place.
    const created = (await this.store.listShows()).filter((s) => !existing.has(s.id));
    created.sort((a, b) => Number(b.mode === 'LATEST') - Number(a.mode === 'LATEST') || a.name.localeCompare(b.name));
    await mapLimit(created, 5, async (s, i) => {
      if (provisional.get(s.id) === s.priority) await this.store.updateShow(s.id, { priority: basePriority + i + 1 });
    });

    return { shows: saved.length, newEpisodes, failed };
  }

  private async syncSingle(showId: string) {
    const show = await this.library.requireShow(showId);
    const settings = await this.store.getSettings();
    const newEpisodes = await this.syncShow(showId, undefined, show, true, settings, () => show.priority);
    return { shows: 1, newEpisodes, failed: 0 };
  }

  /** Returns the number of episodes that were not known before. */
  private async syncShow(
    showId: string,
    raw: SpotifyShow | undefined,
    prev: Show | undefined,
    full: boolean,
    settings: Settings,
    nextPriority: (showId: string) => number,
  ): Promise<number> {
    const now = new Date();
    const nowIso = now.toISOString();
    const known = new Map((await this.store.listEpisodes(showId)).map((e) => [e.id, e]));
    // Episodes stored without a listing order can only be numbered from the complete listing.
    const doFull = full || !prev?.fullSyncAt || [...known.values()].some((e) => e.listingOrder === undefined);
    // A new podcast starts with the default window from the settings.
    const windowDays = prev ? prev.syncWindowDays : settings.newShowSyncWindowDays;
    const cutoff = syncCutoff(windowDays, now);

    // Spotify lists the newest episodes first, so paging can stop at the first
    // page reaching past the window, or (incrementally) at a known episode.
    const fetched = (
      await this.spotify.getShowEpisodes(
        showId,
        (page) =>
          page.some((e) => !inSyncWindow(e.release_date, cutoff)) || (!doFull && page.some((e) => known.has(e.id))),
      )
    ).filter((e) => inSyncWindow(e.release_date, cutoff));
    const episodes = withListingOrder(
      fetched.map((e) => toEpisode(e, showId, known.get(e.id), nowIso)),
      known,
    );
    const added = episodes.filter((e) => !known.has(e.id)).length;
    const changed = episodes.filter((e) => episodeChanged(known.get(e.id), e));

    // Incremental syncs only see the newest page, so refresh the resume point
    // of the current "next" episode explicitly – that's the one that matters.
    const nextId = prev?.summary?.nextEpisode?.id;
    const storedNext = nextId ? known.get(nextId) : undefined;
    const nextInWindow = !!storedNext && inSyncWindow(storedNext.releaseDate, cutoff);
    if (!doFull && storedNext && nextInWindow && !episodes.some((e) => e.id === nextId)) {
      const refreshed = await refetchEpisode(this.spotify, storedNext, nowIso);
      if (refreshed) changed.push(refreshed);
    }
    if (changed.length) await this.store.putEpisodes(changed);

    // Removed: what a complete listing no longer has, and what fell out of the
    // window. Personal progress and notes of these episodes stay.
    const fetchedIds = new Set(fetched.map((e) => e.id));
    const stale = [...known.values()]
      .filter((e) => (doFull && fetched.length > 0 && !fetchedIds.has(e.id)) || !inSyncWindow(e.releaseDate, cutoff))
      .map((e) => e.id);
    if (stale.length) await this.store.deleteEpisodes(showId, stale);

    const metadata: Partial<Show> = raw
      ? {
          name: raw.name,
          description: truncate(raw.description ?? '', 2000),
          publisher: raw.publisher,
          imageUrl: pickImage(raw.images),
          spotifyUrl: raw.external_urls?.spotify ?? `https://open.spotify.com/show/${raw.id}`,
          totalEpisodes: raw.total_episodes,
          mediaType: raw.media_type,
          followed: true,
          unfollowedAt: undefined,
        }
      : {};

    if (!prev) {
      const name = raw?.name ?? showId;
      const description = raw?.description ?? '';
      const show: Show = {
        id: showId,
        source: 'spotify',
        name,
        description: '',
        spotifyUrl: `https://open.spotify.com/show/${showId}`,
        mode: guessMode(episodes, `${name} ${description}`),
        categories: guessCategories(name, description, settings.categories),
        paused: false,
        hiddenFromToday: false,
        priority: nextPriority(showId),
        pinnedEpisodeId: null,
        reofferSkipped: false,
        syncWindowDays: windowDays && windowDays > 0 ? windowDays : null,
        needsReview: true,
        followed: true,
        createdAt: nowIso,
        updatedAt: nowIso,
        ...metadata,
        lastSyncedAt: nowIso,
        fullSyncAt: nowIso,
      };
      await this.store.putShow(show);
    } else {
      await this.store.updateShow(showId, {
        ...metadata,
        lastSyncedAt: nowIso,
        fullSyncAt: doFull ? nowIso : prev.fullSyncAt,
        lastSyncError: undefined,
      });
    }
    await this.library.recompute(showId, settings);
    return prev ? added : 0;
  }
}
