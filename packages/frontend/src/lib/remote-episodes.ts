import type { PlayTarget } from './player/now-playing';
import { readStoredJson, writeStored } from './storage';

/**
 * An episode started outside the browser player (Spotify app or a Connect
 * device). It is remembered in this browser so its progress can be read back
 * from Spotify when the user returns.
 */
export interface RemoteEpisode {
  showId: string;
  episodeId: string;
  name: string;
  showName: string;
  imageUrl?: string;
  durationMs: number;
  target: PlayTarget;
  startedAt: number;
}

const KEY = 'pm.remoteEpisodes';
const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX = 5;

/** The remembered episodes started within the last 24 hours, newest first. */
export function loadRemoteEpisodes(now = Date.now()): RemoteEpisode[] {
  const raw = readStoredJson(KEY);
  if (!Array.isArray(raw)) return [];
  return (raw as RemoteEpisode[]).filter((e) => typeof e?.episodeId === 'string' && now - e.startedAt < KEEP_MS);
}

function save(list: RemoteEpisode[]) {
  writeStored(KEY, JSON.stringify(list));
}

export function rememberRemoteEpisode(episode: RemoteEpisode) {
  const rest = loadRemoteEpisodes(episode.startedAt).filter((e) => e.episodeId !== episode.episodeId);
  save([episode, ...rest].slice(0, MAX));
}

export function forgetRemoteEpisode(episodeId: string) {
  save(loadRemoteEpisodes().filter((e) => e.episodeId !== episodeId));
}
