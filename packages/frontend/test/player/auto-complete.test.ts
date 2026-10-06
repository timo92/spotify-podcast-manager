import { describe, expect, it } from 'vitest';
import { shouldAutoComplete } from '../../src/lib/player/auto-complete';
import type { NowPlaying, PlayTarget } from '../../src/lib/player/now-playing';

const END = 20 * 60_000;
const at = (positionMs: number, target: PlayTarget, more: Partial<NowPlaying> = {}): NowPlaying => ({
  showId: 's',
  episodeId: 'e1',
  name: 'Folge',
  showName: 'Show',
  durationMs: END,
  positionMs,
  paused: false,
  target,
  completed: false,
  ...more,
});
const browser: PlayTarget = { kind: 'browser' };
const app: PlayTarget = { kind: 'app' };

describe('shouldAutoComplete', () => {
  it('needs the browser player within seconds of the end', () => {
    expect(shouldAutoComplete(at(END - 3_000, browser), at(0, browser, { paused: true }))).toBe(true);
    expect(shouldAutoComplete(at(END - 20_000, browser), at(0, browser, { paused: true }))).toBe(false);
  });

  it('allows playback outside the browser to be a poll away from the end', () => {
    expect(shouldAutoComplete(at(END - 40_000, app), at(0, app, { paused: true }))).toBe(true);
    expect(shouldAutoComplete(at(END - 60_000, app), at(0, app, { paused: true }))).toBe(false);
  });

  it('does not count closing the player bar or an episode that was not shown', () => {
    expect(shouldAutoComplete(at(END - 3_000, browser), null)).toBe(false);
    expect(shouldAutoComplete(null, at(0, browser))).toBe(false);
  });
});
