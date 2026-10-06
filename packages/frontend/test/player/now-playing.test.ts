import { describe, expect, it } from 'vitest';
import { nowPlayingReducer, type NowPlaying } from '../../src/lib/player/now-playing';
import type { RemoteEpisode } from '../../src/lib/remote-episodes';

const shown = (more: Partial<NowPlaying> = {}): NowPlaying => ({
  showId: 's',
  episodeId: 'e1',
  name: 'Folge',
  showName: 'Show',
  durationMs: 60_000,
  positionMs: 10_000,
  paused: false,
  target: { kind: 'browser' },
  completed: false,
  ...more,
});
const sdkState = (episodeId: string, position: number, paused = false) =>
  ({
    paused,
    position,
    duration: 60_000,
    track_window: { current_track: { uri: `spotify:episode:${episodeId}` } },
  }) as unknown as Spotify.PlaybackState;
const entry: RemoteEpisode = {
  showId: 's',
  episodeId: 'e1',
  name: 'Folge',
  showName: 'Show',
  durationMs: 0,
  target: { kind: 'app' },
  startedAt: 0,
};

describe('nowPlayingReducer', () => {
  it("applies the browser player's state only to an episode shown in the browser", () => {
    expect(nowPlayingReducer(shown(), { type: 'sdkState', state: sdkState('e1', 20_000) })).toMatchObject({
      positionMs: 20_000,
    });
    const remote = shown({ target: { kind: 'app' } });
    expect(nowPlayingReducer(remote, { type: 'sdkState', state: sdkState('e1', 20_000) })).toBe(remote);
  });

  it('pauses the shown episode when the browser player moved on to another, without taking over its position', () => {
    expect(nowPlayingReducer(shown(), { type: 'sdkState', state: sdkState('e2', 500) })).toMatchObject({
      episodeId: 'e1',
      positionMs: 10_000,
      paused: true,
    });
  });

  it("shows a followed episode with Spotify's length and keeps it marked as heard", () => {
    const state = { episodeId: 'e1', positionMs: 30_000, durationMs: 90_000, paused: false, deviceName: 'Phone' };
    const cur = shown({ target: { kind: 'app' }, completed: true });
    expect(nowPlayingReducer(cur, { type: 'remotePoll', entry, state })).toMatchObject({
      durationMs: 90_000,
      positionMs: 30_000,
      deviceName: 'Phone',
      completed: true,
    });
  });

  it('takes the resume point of a refreshed episode only while its bar is paused', () => {
    const refreshed = { type: 'remoteRefreshed', episodeId: 'e1', positionMs: 40_000, completed: false } as const;
    const paused = shown({ target: { kind: 'app' }, paused: true });
    expect(nowPlayingReducer(paused, refreshed)?.positionMs).toBe(40_000);
    expect(nowPlayingReducer({ ...paused, paused: false }, refreshed)?.positionMs).toBe(10_000);
  });

  it('marks only the shown episode', () => {
    const cur = shown();
    expect(nowPlayingReducer(cur, { type: 'marked', episodeId: 'e2', completed: true })).toBe(cur);
    expect(nowPlayingReducer(cur, { type: 'marked', episodeId: 'e1', completed: true })?.completed).toBe(true);
  });
});
