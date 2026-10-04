import { guessCategories, guessMode, truncate, type Episode, type Settings, type Show, type SyncState } from '@podcast/shared';
import { ApiError, notFound } from '../errors.js';
import type { SpotifyApi, SpotifyEpisode, SpotifyImage, SpotifyShow } from '../spotify/types.js';
import type { Store } from '../store/types.js';
import { LibraryService, mapLimit } from './library.js';

export interface SyncOptions {
  /** Re-import all episodes of every show (otherwise only new ones). */
  full?: boolean;
  /** Only sync this show (always a full re-import). */
  showId?: string;
}

/** A sync that has been "running" for longer than this is considered dead. */
export const STALE_SYNC_MS = 16 * 60 * 1000;

export function isSyncRunning(state: SyncState, now = Date.now()): boolean {
  return state.status === 'running' && !!state.startedAt && now - Date.parse(state.startedAt) < STALE_SYNC_MS;
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

function episodeChanged(prev: Episode | undefined, next: Episode): boolean {
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

  async run(opts: SyncOptions = {}): Promise<SyncState> {
    const prev = await this.store.getSyncState();
    const startedAt = new Date().toISOString();
    await this.store.putSyncState({
      ...prev,
      status: 'running',
      startedAt,
      message: opts.showId ? 'Podcast wird neu geladen…' : 'Synchronisiere mit Spotify…',
      error: undefined,
    });
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
        newEpisodes: result.newEpisodes,
        message:
          result.failed > 0
            ? `${result.shows} Podcasts synchronisiert, ${result.failed} mit Fehlern.`
            : `${result.shows} Podcasts synchronisiert, ${result.newEpisodes} neue Folgen.`,
      };
    } catch (e) {
      state = {
        ...prev,
        status: 'error',
        startedAt,
        finishedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
        message: undefined,
      };
    }
    await this.store.putSyncState(state);
    return state;
  }

  private async syncAll(full: boolean) {
    const [saved, existingList, settings] = await Promise.all([
      this.spotify.getSavedShows(),
      this.store.listShows(),
      this.store.getSettings(),
    ]);
    const existing = new Map(existingList.map((s) => [s.id, s]));
    const savedIds = new Set(saved.map((s) => s.id));

    // Shows removed from the Spotify library are kept (with their progress)
    // but no longer suggested.
    for (const show of existingList) {
      if (!savedIds.has(show.id) && show.followed) {
        await this.store.updateShow(show.id, { followed: false });
        await this.library.recompute(show.id, settings);
      }
    }

    let maxPriority = existingList.reduce((m, s) => Math.max(m, s.priority), 0);
    let newEpisodes = 0;
    let failed = 0;
    let lastError: unknown;
    await mapLimit(saved, 3, async (raw) => {
      try {
        newEpisodes += await this.syncShow(raw.id, raw, existing.get(raw.id), full, settings, () => ++maxPriority);
      } catch (e) {
        // Auth problems affect every show – abort instead of failing 50 times.
        if (e instanceof ApiError && (e.status === 401 || e.code === 'spotify_rate_limited')) throw e;
        failed++;
        lastError = e;
        if (existing.has(raw.id)) {
          await this.store.updateShow(raw.id, { lastSyncError: e instanceof Error ? e.message : String(e) });
        }
      }
    });
    if (failed > 0 && failed === saved.length) throw lastError;
    return { shows: saved.length, newEpisodes, failed };
  }

  private async syncSingle(showId: string) {
    const show = await this.store.getShow(showId);
    if (!show) throw notFound('Podcast nicht gefunden');
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
      } as Show;
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
