import type { EpisodeView, PlaybackState } from '@podcast/shared';
import type { RemoteEpisode } from '../remote-episodes';

/** Where "Abspielen" sends an episode. */
export type PlayTarget = { kind: 'browser' } | { kind: 'app' } | { kind: 'device'; id: string; name: string };

export interface NowPlaying {
  showId: string;
  episodeId: string;
  name: string;
  showName: string;
  imageUrl?: string;
  durationMs: number;
  positionMs: number;
  paused: boolean;
  target: PlayTarget;
  /** True once we marked it as completed automatically. */
  completed: boolean;
  /** For playback outside the browser: the device Spotify reports it on. */
  deviceName?: string;
}

/** The device playback outside the browser runs on, as far as known. */
export const deviceOf = (np: NowPlaying): string | undefined =>
  np.deviceName ?? (np.target.kind === 'device' ? np.target.name : undefined);

/** Whether `episodeId` is the episode the browser player shows (and can control). */
export const playsInBrowser = (np: NowPlaying | null, episodeId: string): np is NowPlaying =>
  np?.episodeId === episodeId && np.target.kind === 'browser';

/**
 * Whether playing `episodeId` means controlling the browser player (pause,
 * resume, seek) rather than starting it on the chosen target: only while the
 * browser is that target.
 */
export const controlsInBrowser = (np: NowPlaying | null, target: PlayTarget, episodeId: string): np is NowPlaying =>
  target.kind === 'browser' && playsInBrowser(np, episodeId);

export interface PlayableItem {
  show: { id: string; name: string; imageUrl?: string };
  episode: Pick<EpisodeView, 'id' | 'name' | 'durationMs' | 'spotifyUrl' | 'imageUrl' | 'status' | 'statusSource'>;
}

/**
 * Everything that changes the episode shown in the player bar. The browser
 * player, the polls of outside playback and the user's actions all report
 * here, so `nowPlayingReducer` is the one place that decides what is shown.
 */
export type NowPlayingEvent =
  /** Playback of `item` started on `target` at the position the API answered with. */
  | { type: 'played'; item: PlayableItem; target: PlayTarget; positionMs: number; durationMs: number }
  /** The browser player reported its state. */
  | { type: 'sdkState'; state: Spotify.PlaybackState }
  /** A poll found the remembered `entry` playing outside the browser. */
  | { type: 'remotePoll'; entry: RemoteEpisode; state: PlaybackState }
  /** A remembered episode was read back from Spotify (`positionMs` is its resume point). */
  | { type: 'remoteRefreshed'; episodeId: string; positionMs: number; completed: boolean }
  /** Following outside playback stopped: it was paused, ended or moved on. */
  | { type: 'followStopped' }
  | { type: 'toggled' }
  | { type: 'seeked'; positionMs: number }
  /** The episode was marked as heard (or, after a failure, not). */
  | { type: 'marked'; episodeId: string; completed: boolean }
  | { type: 'closed' };

export function nowPlayingReducer(cur: NowPlaying | null, event: NowPlayingEvent): NowPlaying | null {
  switch (event.type) {
    case 'played':
      return started(event.item, event.target, event);
    case 'sdkState':
      return cur?.target.kind === 'browser' ? applySdkState(cur, event.state) : cur;
    case 'remotePoll':
      return followed(cur, event.entry, event.state);
    case 'remoteRefreshed': {
      if (cur?.episodeId !== event.episodeId || cur.target.kind === 'browser') return cur;
      // Spotify often reports nothing for an app paused in the background, so
      // a paused bar takes the resume point over; a playing one is newer.
      const positionMs = cur.paused && !event.completed ? event.positionMs : cur.positionMs;
      return { ...cur, positionMs, completed: cur.completed || event.completed };
    }
    case 'followStopped':
      return cur && cur.target.kind !== 'browser' ? { ...cur, paused: true } : cur;
    case 'toggled':
      return cur && { ...cur, paused: !cur.paused };
    case 'seeked':
      return cur && { ...cur, positionMs: event.positionMs };
    case 'marked':
      return cur?.episodeId === event.episodeId ? { ...cur, completed: event.completed } : cur;
    case 'closed':
      return null;
  }
}

function started(item: PlayableItem, target: PlayTarget, res: { positionMs: number; durationMs: number }): NowPlaying {
  return {
    showId: item.show.id,
    episodeId: item.episode.id,
    name: item.episode.name,
    showName: item.show.name,
    imageUrl: item.episode.imageUrl ?? item.show.imageUrl,
    durationMs: res.durationMs || item.episode.durationMs,
    positionMs: res.positionMs,
    paused: false,
    target,
    completed: item.episode.status === 'COMPLETED',
  };
}

/**
 * The browser player's state applied to the shown episode. A state of another
 * episode (Spotify autoplays the next one, or starts one the app is about to
 * show) means the shown one stopped; its position is never taken over.
 */
function applySdkState(cur: NowPlaying, state: Spotify.PlaybackState): NowPlaying {
  const track = state.track_window.current_track;
  if (track && track.uri !== `spotify:episode:${cur.episodeId}`) return cur.paused ? cur : { ...cur, paused: true };
  return { ...cur, paused: state.paused, positionMs: state.position, durationMs: state.duration || cur.durationMs };
}

function followed(cur: NowPlaying | null, entry: RemoteEpisode, state: PlaybackState): NowPlaying {
  return {
    showId: entry.showId,
    episodeId: entry.episodeId,
    name: entry.name,
    showName: entry.showName,
    imageUrl: entry.imageUrl,
    // An episode started without a known length (e.g. from a note) gets Spotify's.
    durationMs: state.durationMs || entry.durationMs,
    positionMs: state.positionMs,
    paused: state.paused,
    target: entry.target,
    deviceName: state.deviceName,
    completed: cur?.episodeId === entry.episodeId && cur.completed,
  };
}
