import { afterEach, describe, expect, it } from 'vitest';
import {
  forgetRemoteEpisode,
  loadRemoteEpisodes,
  rememberRemoteEpisode,
  type RemoteEpisode,
} from '../src/lib/remote-episodes';

const HOUR = 60 * 60 * 1000;
const entry = (episodeId: string, startedAt: number): RemoteEpisode => ({
  showId: 's',
  episodeId,
  name: episodeId,
  showName: 'Show',
  durationMs: 1000,
  target: { kind: 'app' },
  startedAt,
});

afterEach(() => localStorage.clear());

describe('remembered remote episodes', () => {
  it('keeps the newest five of the last 24 hours, newest first, each episode once', () => {
    const now = Date.now();
    for (let i = 1; i <= 6; i++) rememberRemoteEpisode(entry(`e${i}`, now - (7 - i) * HOUR));
    rememberRemoteEpisode(entry('e3', now));
    expect(loadRemoteEpisodes(now).map((e) => e.episodeId)).toEqual(['e3', 'e6', 'e5', 'e4', 'e2']);
    expect(loadRemoteEpisodes(now + 24 * HOUR - 1).map((e) => e.episodeId)).toEqual(['e3']);
  });

  it('forgets an episode', () => {
    rememberRemoteEpisode(entry('a', Date.now()));
    rememberRemoteEpisode(entry('b', Date.now()));
    forgetRemoteEpisode('a');
    expect(loadRemoteEpisodes().map((e) => e.episodeId)).toEqual(['b']);
  });

  it('ignores unreadable storage', () => {
    localStorage.setItem('pm.remoteEpisodes', '{not json');
    expect(loadRemoteEpisodes()).toEqual([]);
  });
});
