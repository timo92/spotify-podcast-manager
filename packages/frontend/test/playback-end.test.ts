import { describe, expect, it } from 'vitest';
import { playbackEnded } from '../src/lib/playback-end';
import type { NowPlaying } from '../src/lib/player';

const MIN = 60_000;
const at = (positionMs: number, more: Partial<NowPlaying> = {}): NowPlaying => ({
  showId: 's',
  episodeId: 'e1',
  name: 'Folge',
  showName: 'Show',
  durationMs: 20 * MIN,
  positionMs,
  paused: false,
  target: { kind: 'browser' },
  completed: false,
  ...more,
});
const END = 20 * MIN;
const WINDOW = 5_000;

describe('playbackEnded', () => {
  it('needs the episode to have been playing within the end window', () => {
    expect(playbackEnded(at(END - 3_000), at(END - 3_000, { paused: true }), WINDOW)).toBe(true);
    expect(playbackEnded(at(END - 60_000), at(END - 60_000, { paused: true }), WINDOW)).toBe(false);
    expect(playbackEnded(at(END - 3_000, { paused: true }), at(0, { paused: true }), WINDOW)).toBe(false);
  });

  it('counts stopping, moving on, starting over and sitting at the end as an end', () => {
    const near = at(END - 2_000);
    expect(playbackEnded(near, at(0, { paused: true }), WINDOW)).toBe(true);
    expect(playbackEnded(near, at(1_000), WINDOW)).toBe(true);
    expect(playbackEnded(near, at(30_000, { episodeId: 'e2' }), WINDOW)).toBe(true);
    expect(playbackEnded(near, at(END - 500), WINDOW)).toBe(true);
  });

  it('does not count playing on, seeking back, closing or an episode already heard', () => {
    const near = at(END - 4_000);
    expect(playbackEnded(near, at(END - 3_000), WINDOW)).toBe(false);
    expect(playbackEnded(near, at(10 * MIN), WINDOW)).toBe(false);
    expect(playbackEnded(near, null, WINDOW)).toBe(false);
    expect(playbackEnded(at(END - 2_000, { completed: true }), at(0, { paused: true }), WINDOW)).toBe(false);
    expect(playbackEnded(near, at(END - 500, { completed: true }), WINDOW)).toBe(false);
  });

  it('uses the wider window for playback followed every 30 seconds', () => {
    const remote = at(END - 40_000, { target: { kind: 'app' } });
    expect(playbackEnded(remote, { ...remote, paused: true }, 45_000)).toBe(true);
    expect(playbackEnded(remote, { ...remote, paused: true }, WINDOW)).toBe(false);
  });
});
