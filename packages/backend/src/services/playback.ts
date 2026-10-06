import type { Episode, EpisodeView, PlaybackState } from '@podcast/shared';
import { notFound } from '../errors.js';
import type { SpotifyApi } from '../spotify/types.js';
import type { Store } from '../store/types.js';
import type { LibraryService } from './library.js';
import { refetchEpisode } from './sync.js';

/**
 * Playback outside the browser player (Spotify app, Connect devices): the
 * web app learns about it only by asking Spotify, between the scheduled syncs.
 */
export class PlaybackService {
  constructor(
    private readonly store: Store,
    private readonly library: LibraryService,
    private readonly spotify: () => SpotifyApi,
  ) {}

  /**
   * Re-reads one episode from Spotify and stores what changed (resume point,
   * metadata), like the sync does for it. Returns the episode as the app shows it.
   */
  async refreshEpisode(showId: string, episodeId: string): Promise<EpisodeView> {
    await this.syncEpisode(this.spotify(), showId, episodeId);
    return this.library.episode(showId, episodeId);
  }

  /**
   * Starts an episode on a device (the active one if none is given), where
   * Spotify left off unless `fromStart` or an explicit `positionMs` says otherwise.
   * Re-reads the episode first, so progress made elsewhere is both used and stored.
   */
  async play(
    showId: string,
    episodeId: string,
    opts: { deviceId?: string; fromStart?: boolean; positionMs?: number } = {},
  ): Promise<{ positionMs: number; durationMs: number }> {
    const spotify = this.spotify();
    const episode = await this.syncEpisode(spotify, showId, episodeId);
    const resume = episode.resumePoint;
    let positionMs = !opts.fromStart && resume && !resume.fullyPlayed ? resume.resumePositionMs : 0;
    if (opts.positionMs !== undefined && Number.isFinite(opts.positionMs) && opts.positionMs >= 0) {
      positionMs = Math.min(opts.positionMs, Math.max(0, episode.durationMs - 1000));
    }
    await spotify.play(episodeId, opts.deviceId, positionMs);
    return { positionMs, durationMs: episode.durationMs };
  }

  /** Stores what Spotify reports for one episode, like the sync does, and returns it. */
  private async syncEpisode(spotify: SpotifyApi, showId: string, episodeId: string): Promise<Episode> {
    const cached = await this.store.getEpisode(showId, episodeId);
    if (!cached) throw notFound('episode_not_found');
    const changed = await refetchEpisode(spotify, cached, new Date().toISOString());
    if (!changed) return cached;
    await this.store.putEpisodes([changed]);
    await this.library.recompute(showId);
    return changed;
  }

  /** The episode Spotify plays right now on any device, or null. */
  async state(): Promise<PlaybackState | null> {
    return (await this.spotify().getPlayingEpisode()) ?? null;
  }
}
