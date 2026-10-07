import type { PlaybackState } from '@podcast/shared';
import type { PlayableItem } from './now-playing';

/**
 * What to do when Spotify plays `state` after an episode of the "Up next"
 * playlist: follow the playlist's next episode; or pause, when the previous
 * episode ran to its end and Spotify plays something outside the list (its
 * Autoplay, which still reports the playlist as context); otherwise leave it.
 */
export function afterUpNext(state: PlaybackState | null, previousEnded: boolean): 'follow' | 'pause' | 'ignore' {
  if (!state) return 'ignore';
  if (state.upNextEpisode) return 'follow';
  if (state.inUpNext === false && previousEnded && !state.paused) return 'pause';
  return 'ignore';
}

/** The playing "Up next" episode as an item the player can show. */
export function upNextItem(state: PlaybackState): PlayableItem | undefined {
  const e = state.upNextEpisode;
  if (!e) return undefined;
  return {
    show: { id: e.showId, name: e.showName, imageUrl: e.imageUrl },
    episode: {
      id: state.episodeId,
      name: e.name,
      durationMs: e.durationMs,
      imageUrl: e.imageUrl,
      spotifyUrl: `https://open.spotify.com/episode/${state.episodeId}`,
      status: 'UNSEEN',
      statusSource: 'default',
    },
  };
}
