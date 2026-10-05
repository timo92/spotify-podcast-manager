import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, formatReleaseDate, formatWeekdays } from '../src/lib/format';

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(32 * 60_000)).toBe('32 min');
    expect(formatDuration(65 * 60_000)).toBe('1 h 05 min');
    expect(formatDuration(120 * 60_000)).toBe('2 h');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });

  it('formats release dates relative to today', () => {
    const now = new Date(2026, 9, 5, 9);
    expect(formatReleaseDate('2026-10-05', now)).toBe('Heute');
    expect(formatReleaseDate('2026-10-04', now)).toBe('Gestern');
    expect(formatReleaseDate('2024-03-01', now)).toContain('2024');
  });
});

describe('formatWeekdays', () => {
  it('lists single days and shortens runs of three or more', () => {
    expect(formatWeekdays([1, 3, 5])).toBe('Mo, Mi, Fr');
    expect(formatWeekdays([5, 1, 2, 3, 4])).toBe('Mo–Fr');
    expect(formatWeekdays([6, 7])).toBe('Sa, So');
    expect(formatWeekdays([1, 2, 3, 6])).toBe('Mo–Mi, Sa');
    expect(formatWeekdays([1, 2, 3, 4, 5, 6, 7])).toBe('Mo–So');
  });
});

describe('splitTimestamps', () => {
  it('finds mm:ss and h:mm:ss timestamps', async () => {
    const { splitTimestamps } = await import('../src/lib/format');
    expect(splitTimestamps('a [2:05] b [1:00:01]')).toEqual([
      { text: 'a ' },
      { label: '[2:05]', ms: 125_000 },
      { text: ' b ' },
      { label: '[1:00:01]', ms: 3_601_000 },
    ]);
    expect(splitTimestamps('kein Zeitstempel')).toEqual([{ text: 'kein Zeitstempel' }]);
  });
});
