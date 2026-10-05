import type { EpisodeView, PlaybackState } from '@podcast/shared';
import { notFound } from '../errors.js';
import type { SpotifyApi } from '../spotify/types.js';
import type { Store } from '../store/types.js';
import type { LibraryService } from './library.js';
import { episodeChanged, toEpisode } from './sync.js';

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
    const cached = await this.store.getEpisode(showId, episodeId);
    if (!cached) throw notFound('episode_not_found', 'Folge nicht gefunden');
    const fresh = await this.spotify().getEpisode(episodeId);
    if (fresh) {
      const episode = toEpisode(fresh, showId, cached.firstSeenAt, new Date().toISOString());
      if (episodeChanged(cached, episode)) {
        await this.store.putEpisodes([episode]);
        await this.library.recompute(showId);
      }
    }
    return this.library.episode(showId, episodeId);
  }

  /** The episode Spotify plays right now on any device, or null. */
  async state(): Promise<PlaybackState | null> {
    return (await this.spotify().getPlayingEpisode()) ?? null;
  }
}
