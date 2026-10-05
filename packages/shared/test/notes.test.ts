import { describe, expect, it } from 'vitest';
import { byPosition, groupNotesByShow, notesInRange, presetRange } from '../src/notes.js';
import type { EpisodeNote } from '../src/types.js';

const note = (
  showId: string,
  episodeId: string,
  createdAt: string,
  episodeReleaseDate?: string,
  positionMs: number | null = null,
): EpisodeNote => ({
  id: `${episodeId}-${positionMs}-${createdAt}`,
  showId,
  episodeId,
  positionMs,
  text: 'x',
  createdAt,
  updatedAt: createdAt,
  showName: showId,
  episodeReleaseDate,
});

describe('presetRange', () => {
  it('computes this week, the last 30 days and this year up to today', () => {
    expect(presetRange('week', '2026-10-07')).toEqual({ from: '2026-10-05', to: '2026-10-07' }); // a Wednesday
    expect(presetRange('week', '2026-10-05')).toEqual({ from: '2026-10-05', to: '2026-10-05' });
    expect(presetRange('last30', '2026-10-05')).toEqual({ from: '2026-09-06', to: '2026-10-05' });
    expect(presetRange('year', '2026-10-05')).toEqual({ from: '2026-01-01', to: '2026-10-05' });
  });
});

describe('notesInRange', () => {
  const notes = [note('a', '1', '2026-10-04T22:30:00Z'), note('a', '2', '2026-09-01T10:00:00Z')];

  it('filters by the local date the note was written, both ends inclusive', () => {
    // 22:30 UTC on Oct 4 is already Oct 5 in Berlin.
    expect(notesInRange(notes, { from: '2026-10-05' }, 'Europe/Berlin').map((n) => n.episodeId)).toEqual(['1']);
    expect(notesInRange(notes, { from: '2026-10-05' }, 'UTC')).toEqual([]);
    expect(notesInRange(notes, { to: '2026-09-01' }, 'UTC').map((n) => n.episodeId)).toEqual(['2']);
    expect(notesInRange(notes, {}, 'UTC')).toBe(notes);
  });

  it('ignores later edits', () => {
    const edited = { ...note('a', '1', '2026-09-01T10:00:00Z'), updatedAt: '2026-10-05T10:00:00Z' };
    expect(notesInRange([edited], { from: '2026-10-01' }, 'UTC')).toEqual([]);
  });
});

describe('byPosition', () => {
  it('puts notes on the whole episode first, then orders by position and by when they were written', () => {
    const notes = [
      note('a', '1', '2026-10-02T00:00:00Z', undefined, 90_000),
      note('a', '1', '2026-10-03T00:00:00Z', undefined, null),
      note('a', '1', '2026-10-01T00:00:00Z', undefined, 90_000),
      note('a', '1', '2026-10-04T00:00:00Z', undefined, 5_000),
    ];
    expect(notes.sort(byPosition).map((n) => [n.positionMs, n.createdAt.slice(8, 10)])).toEqual([
      [null, '03'],
      [5_000, '04'],
      [90_000, '01'],
      [90_000, '02'],
    ]);
  });
});

describe('groupNotesByShow', () => {
  it('groups by podcast, most recently written podcast first, notes in episode order', () => {
    const groups = groupNotesByShow([
      note('series', 'e3', '2026-10-01T00:00:00Z', '2026-03-01'),
      note('news', 'n1', '2026-10-05T00:00:00Z', '2026-10-04'),
      note('series', 'e1', '2026-09-01T00:00:00Z', '2026-01-01'),
      note('series', 'old-b', '2026-08-02T00:00:00Z'),
      note('series', 'old-a', '2026-08-01T00:00:00Z'),
    ]);
    expect(groups.map((g) => [g.showId, g.notes.map((n) => n.episodeId)])).toEqual([
      ['news', ['n1']],
      ['series', ['e1', 'e3', 'old-b', 'old-a']],
    ]);
  });

  it('keeps the notes of an episode together, ordered by position', () => {
    const [group] = groupNotesByShow([
      note('s', 'e2', '2026-10-01T00:00:00Z', '2026-02-01', 60_000),
      note('s', 'e1', '2026-10-02T00:00:00Z', '2026-01-01', 30_000),
      note('s', 'e2', '2026-10-03T00:00:00Z', '2026-02-01', 10_000),
      note('s', 'e1', '2026-10-04T00:00:00Z', '2026-01-01', null),
    ]);
    expect(group.notes.map((n) => [n.episodeId, n.positionMs])).toEqual([
      ['e1', null],
      ['e1', 30_000],
      ['e2', 10_000],
      ['e2', 60_000],
    ]);
  });
});
