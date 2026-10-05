import { describe, expect, it } from 'vitest';
import { groupNotesByShow, notesInRange, presetRange } from '../src/notes.js';
import type { EpisodeNote } from '../src/types.js';

const note = (showId: string, episodeId: string, updatedAt: string, episodeReleaseDate?: string): EpisodeNote => ({
  showId,
  episodeId,
  text: 'x',
  createdAt: updatedAt,
  updatedAt,
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

  it('filters by the local date of the last edit, both ends inclusive', () => {
    // 22:30 UTC on Oct 4 is already Oct 5 in Berlin.
    expect(notesInRange(notes, { from: '2026-10-05' }, 'Europe/Berlin').map((n) => n.episodeId)).toEqual(['1']);
    expect(notesInRange(notes, { from: '2026-10-05' }, 'UTC')).toEqual([]);
    expect(notesInRange(notes, { to: '2026-09-01' }, 'UTC').map((n) => n.episodeId)).toEqual(['2']);
    expect(notesInRange(notes, {}, 'UTC')).toBe(notes);
  });
});

describe('groupNotesByShow', () => {
  it('groups by podcast, newest edited podcast first, notes in episode order', () => {
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
});
