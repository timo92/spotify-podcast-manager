import { randomUUID } from 'node:crypto';
import { StatusCodes } from 'http-status-codes';
import {
  guessCategories,
  guessMode,
  truncate,
  type Episode,
  type Settings,
  type Show,
  type SyncState,
} from '@podcast/shared';
import { ApiError, notFound } from '../errors.js';
import type { SpotifyApi, SpotifyEpisode, SpotifyImage, SpotifyShow } from '../spotify/types.js';
import type { Store } from '../store/types.js';
import { LibraryService, mapLimit } from './library.js';
import { applyRetention } from './retention.js';

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

/** Ends a lease without a sync result, e.g. when the triggered run could not start. */
export async function releaseSyncLease(store: Store, lease: SyncState & { leaseId: string }, error?: ApiError) {
  await store.releaseSyncLease(lease.leaseId, {
    ...lease,
    status: error ? 'error' : 'idle',
    error: error?.message,
    errorCode: error?.code,
    errorParams: error?.params,
    showId: undefined,
    message: undefined,
    leaseId: undefined,
    finishedAt: new Date().toISOString(),
  });
}

export function pickImage(images: SpotifyImage[] | undefined): string | undefined {
  if (!images?.length) return undefined;
  const sorted = [...images].sort((a, b) => Math.abs((a.width ?? 300) - 300) - Math.abs((b.width ?? 300) - 300));
  return sorted[0].url;
}

export function toEpisode(raw: SpotifyEpisode, showId: string, firstSeenAt: string, now: string): Episode {
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
    firstSeenAt,
    lastSyncedAt: now,
  };
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
  constructor(
    private readonly store: Store,
    private readonly spotify: SpotifyApi,
    private readonly library = new LibraryService(store),
  ) {}

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
      state = {
        ...lease,
        status: 'error',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
        errorCode: e instanceof ApiError ? e.code : undefined,
        errorParams: e instanceof ApiError ? e.params : undefined,
        showId: undefined,
        message: undefined,
        leaseId: undefined,
      };
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
    let newEpisodes = 0;
    let failed = 0;
    let lastError: unknown;
    await mapLimit(saved, 3, async (raw) => {
      try {
        newEpisodes += await this.syncShow(raw.id, raw, existing.get(raw.id), full, settings, () => ++maxPriority);
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
    const created = (await this.store.listShows()).filter((s) => !existing.has(s.id));
    created.sort((a, b) => Number(b.mode === 'LATEST') - Number(a.mode === 'LATEST') || a.name.localeCompare(b.name));
    await mapLimit(created, 5, (s, i) => this.store.updateShow(s.id, { priority: basePriority + i + 1 }));

    return { shows: saved.length, newEpisodes, failed };
  }

  private async syncSingle(showId: string) {
    const show = await this.store.getShow(showId);
    if (!show) throw notFound('show_not_found', 'Podcast nicht gefunden');
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
    nextPriority: () => number,
  ): Promise<number> {
    const nowIso = new Date().toISOString();
    const known = new Map((await this.store.listEpisodes(showId)).map((e) => [e.id, e]));
    const doFull = full || !prev?.fullSyncAt;

    const fetched = await this.spotify.getShowEpisodes(
      showId,
      doFull ? undefined : (page) => page.some((e) => known.has(e.id)),
    );
    const episodes = fetched.map((e) => toEpisode(e, showId, known.get(e.id)?.firstSeenAt ?? nowIso, nowIso));
    const added = episodes.filter((e) => !known.has(e.id)).length;
    const changed = episodes.filter((e) => episodeChanged(known.get(e.id), e));

    // Incremental syncs only see the newest page, so refresh the resume point
    // of the current "next" episode explicitly – that's the one that matters.
    const nextId = prev?.summary?.nextEpisode?.id;
    if (!doFull && nextId && known.has(nextId) && !episodes.some((e) => e.id === nextId)) {
      const fresh = await this.spotify.getEpisode(nextId);
      if (fresh) {
        const ep = toEpisode(fresh, showId, known.get(nextId)!.firstSeenAt, nowIso);
        if (episodeChanged(known.get(nextId), ep)) changed.push(ep);
      }
    }
    if (changed.length) await this.store.putEpisodes(changed);

    if (doFull && fetched.length) {
      const fetchedIds = new Set(fetched.map((e) => e.id));
      const stale = [...known.keys()].filter((id) => !fetchedIds.has(id));
      if (stale.length) await this.store.deleteEpisodes(showId, stale);
    }

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
        priority: nextPriority(),
        pinnedEpisodeId: null,
        reofferSkipped: false,
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
