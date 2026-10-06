import type { PlaybackState } from '@podcast/shared';
import { describe, expect, it } from 'vitest';
import { followStep, REMOTE_POLL_MS, type Followed } from '../../src/lib/player/remote-follow';
import type { RemoteEpisode } from '../../src/lib/remote-episodes';

const NOW = 1_000_000_000;
const entry = (episodeId: string, startedAt = NOW - 10 * REMOTE_POLL_MS): RemoteEpisode => ({
  showId: 's',
  episodeId,
  name: episodeId,
  showName: 'Show',
  durationMs: 60_000,
  target: { kind: 'app' },
  startedAt,
});
const playing = (episodeId: string, positionMs: number, paused = false): PlaybackState => ({
  episodeId,
  positionMs,
  durationMs: 60_000,
  paused,
});
const followed = (episodeId: string, lastPositionMs: number, still = 0): Followed => ({
  entry: entry(episodeId),
  lastPositionMs,
  still,
});

describe('followStep', () => {
  it('follows a remembered episode Spotify plays', () => {
    const step = followStep(null, playing('e1', 5_000), [entry('e1')], NOW);
    expect(step).toMatchObject({ kind: 'follow', followed: { lastPositionMs: 5_000, still: 0 }, stop: false });
  });

  it('stops once the episode stood still for two polls', () => {
    const first = followStep(followed('e1', 5_000), playing('e1', 5_000, true), [entry('e1')], NOW);
    expect(first).toMatchObject({ kind: 'follow', followed: { still: 1 }, stop: false });
    const second = followStep(followed('e1', 5_000, 1), playing('e1', 5_000, true), [entry('e1')], NOW);
    expect(second).toMatchObject({ kind: 'follow', followed: { still: 2 }, stop: true });
  });

  it('counts a moving episode as playing again', () => {
    const step = followStep(followed('e1', 5_000, 1), playing('e1', 35_000), [entry('e1')], NOW);
    expect(step).toMatchObject({ kind: 'follow', followed: { still: 0 }, stop: false });
  });

  it('starts counting afresh when Spotify switched to another remembered episode', () => {
    const step = followStep(followed('e1', 5_000, 1), playing('e2', 5_000, true), [entry('e2'), entry('e1')], NOW);
    expect(step).toMatchObject({ kind: 'follow', followed: { entry: { episodeId: 'e2' }, still: 1 } });
  });

  it('waits right after starting, then stops when Spotify plays nothing remembered', () => {
    const fresh = [entry('e1', NOW - 1_000)];
    expect(followStep(null, null, fresh, NOW)).toEqual({ kind: 'wait' });
    expect(followStep(null, playing('other', 0), fresh, NOW)).toEqual({ kind: 'wait' });
    expect(followStep(null, null, [entry('e1')], NOW)).toEqual({ kind: 'stop' });
    expect(followStep(null, playing('other', 0), [entry('e1')], NOW)).toEqual({ kind: 'stop' });
  });
});
