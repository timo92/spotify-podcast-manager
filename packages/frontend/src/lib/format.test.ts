import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration, formatReleaseDate } from './format';

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
