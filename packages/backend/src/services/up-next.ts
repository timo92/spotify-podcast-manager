import { upNextItems, type EpisodeRef, type PlaybackState, type TodayResponse } from '@podcast/shared';
import type { SpotifyApi } from '../spotify/types.js';
import type { Store, UpNextState } from '../store/types.js';
import type { PlanService } from './plan.js';

const PLAYLIST_NAME = 'Podcast-Cockpit: Up next';
const PLAYLIST_DESCRIPTION =
  'Managed by your Podcast-Cockpit: what Today suggests, in order. Changes made here are overwritten.';

export interface UpNextRefresh {
  /** The client's time zone, for Today; without it, the one of the last refresh. */
  timeZone?: string;
  /** Today in that time zone, if the caller has it already. */
  today?: TodayResponse;
  /** The episode about to be started; it goes first. */
  first?: EpisodeRef;
  /** Write the playlist even if its content didn't change (recreates a playlist deleted in Spotify). */
  force?: boolean;
}

const sameItems = (a: EpisodeRef[], b: EpisodeRef[]) =>
  a.length === b.length && a.every((ref, i) => ref.episodeId === b[i]?.episodeId);

/**
 * The "Up next" playlist in the user's Spotify account: Today as a playlist,
 * played as the context of every episode the app starts, so Spotify continues
 * with the next suggestion instead of its Autoplay. Only while the setting is
 * on. The content is rebuilt from the current state whenever it may have
 * changed and written only when it did.
 */
export class UpNextService {
  constructor(
    private readonly store: Store,
    private readonly planner: PlanService,
    private readonly spotify: () => SpotifyApi,
  ) {}

  /**
   * Rewrites the playlist from Today. Without `first`, an episode of the list
   * that plays right now stays first, so replacing the list doesn't change what
   * Spotify plays next. Undefined while the setting is off.
   */
  async refresh(opts: UpNextRefresh = {}): Promise<UpNextState | undefined> {
    const [settings, stored] = await Promise.all([this.store.getSettings(), this.store.getUpNext()]);
    if (!settings.playThroughPlaylist) return undefined;
    const spotify = this.spotify();
    const timeZone = opts.timeZone ?? stored?.timeZone ?? 'UTC';
    const today = opts.today ?? (await this.planner.today(timeZone));
    const items = upNextItems(today, opts.first ?? (await playingFrom(spotify, stored)));
    const now = new Date().toISOString();

    if (stored && !opts.force && sameItems(stored.items, items)) {
      if (stored.timeZone === timeZone) return stored;
      const state = { ...stored, timeZone, updatedAt: now };
      await this.store.putUpNext(state);
      return state;
    }
    const ids = items.map((ref) => ref.episodeId);
    let playlistId = stored?.playlistId ?? (await spotify.createPlaylist(PLAYLIST_NAME, PLAYLIST_DESCRIPTION));
    if (!(await spotify.replacePlaylistItems(playlistId, ids))) {
      // Deleted in Spotify: start a new one.
      playlistId = await spotify.createPlaylist(PLAYLIST_NAME, PLAYLIST_DESCRIPTION);
      await spotify.replacePlaylistItems(playlistId, ids);
    }
    const state: UpNextState = { playlistId, items, timeZone, updatedAt: now };
    await this.store.putUpNext(state);
    return state;
  }

  /**
   * Like `refresh`, but a failure (e.g. the playlist permission is missing) is
   * logged instead of thrown: playback, Today and the sync work without it.
   */
  async refreshQuietly(opts: UpNextRefresh = {}): Promise<UpNextState | undefined> {
    try {
      return await this.refresh(opts);
    } catch (e) {
      console.warn('Up next playlist not updated', e instanceof Error ? e.message : e);
      return undefined;
    }
  }

  /** The playlist's Spotify ID; undefined while the setting is off or before it was first written. */
  async playlistId(): Promise<string | undefined> {
    const [settings, stored] = await Promise.all([this.store.getSettings(), this.store.getUpNext()]);
    return settings.playThroughPlaylist ? stored?.playlistId : undefined;
  }

  /**
   * How the playing episode relates to the playlist: whether it is in the list
   * the playlist last got and, if so, the episode as the app knows it. Nothing
   * while the setting is off or before the playlist was first written.
   */
  async describe(episodeId: string): Promise<Pick<PlaybackState, 'inUpNext' | 'upNextEpisode'>> {
    const [settings, stored] = await Promise.all([this.store.getSettings(), this.store.getUpNext()]);
    if (!settings.playThroughPlaylist || !stored) return {};
    const ref = stored.items.find((item) => item.episodeId === episodeId);
    if (!ref) return { inUpNext: false };
    const [show, episode] = await Promise.all([
      this.store.getShow(ref.showId),
      this.store.getEpisode(ref.showId, ref.episodeId),
    ]);
    if (!show || !episode) return { inUpNext: true };
    return {
      inUpNext: true,
      upNextEpisode: {
        showId: show.id,
        name: episode.name,
        showName: show.name,
        imageUrl: episode.imageUrl ?? show.imageUrl,
        durationMs: episode.durationMs,
      },
    };
  }
}

/** The episode of the stored list that plays right now, if any. */
async function playingFrom(spotify: SpotifyApi, stored: UpNextState | undefined): Promise<EpisodeRef | undefined> {
  if (!stored?.items.length) return undefined;
  // Unknown counts as nothing playing: the list is still worth writing.
  const playing = await spotify.getPlayingEpisode().catch(() => undefined);
  if (!playing || playing.paused) return undefined;
  return stored.items.find((ref) => ref.episodeId === playing.episodeId);
}
