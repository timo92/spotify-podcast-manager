import type { Episode, EpisodeView, PlaybackState, PlayerDevice } from '@podcast/shared';
import { notFound } from '../errors.js';
import type { SpotifyApi } from '../spotify/types.js';
import type { Store } from '../store/types.js';
import type { LibraryService } from './library.js';
import { refetchEpisode } from './sync.js';
import type { UpNextService } from './up-next.js';

/**
 * Playback outside the browser player (Spotify app, Connect devices): the
 * web app learns about it only by asking Spotify, between the scheduled syncs.
 */
export class PlaybackService {
  constructor(
    private readonly store: Store,
    private readonly library: LibraryService,
    private readonly spotify: () => SpotifyApi,
    private readonly upNext: UpNextService,
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
    opts: { deviceId?: string; fromStart?: boolean; positionMs?: number; timeZone?: string } = {},
  ): Promise<{ positionMs: number; durationMs: number }> {
    const spotify = this.spotify();
    const episode = await this.syncEpisode(spotify, showId, episodeId);
    const resume = episode.resumePoint;
    let positionMs = !opts.fromStart && resume && !resume.fullyPlayed ? resume.resumePositionMs : 0;
    if (opts.positionMs !== undefined && Number.isFinite(opts.positionMs) && opts.positionMs >= 0) {
      positionMs = Math.min(opts.positionMs, Math.max(0, episode.durationMs - 1000));
    }
    // Inside the "Up next" playlist (if in use), so Spotify continues with its next item.
    const upNext = await this.upNext.refreshQuietly({
      timeZone: opts.timeZone,
      first: { showId, episodeId },
      force: true,
    });
    await spotify.play(episodeId, opts.deviceId, positionMs, upNext?.playlistId);
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

  /** Connect devices playback can be sent to; restricted ones (Spotify can't control them) are left out. */
  async devices(): Promise<PlayerDevice[]> {
    return (await this.spotify().getDevices()).flatMap((d) =>
      d.id && !d.is_restricted ? [{ id: d.id, name: d.name, type: d.type, isActive: d.is_active }] : [],
    );
  }

  /** A Spotify access token for the browser player. */
  accessToken() {
    return this.spotify().getAccessToken();
  }

  /**
   * The episode Spotify plays right now on any device, or null. While the "Up
   * next" playlist is in use, it also says whether the episode is in it.
   */
  async state(): Promise<PlaybackState | null> {
    const playing = await this.spotify().getPlayingEpisode();
    if (!playing) return null;
    return { ...playing, ...(await this.upNext.describe(playing.episodeId)) };
  }

  /** Pauses playback on whatever device plays (e.g. when Spotify's Autoplay took over). */
  async pause(): Promise<void> {
    await this.spotify().pause();
  }
}
