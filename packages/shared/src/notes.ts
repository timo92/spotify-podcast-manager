import { addDays, localDate, weekdayOf } from './plan.js';
import type { EpisodeNote } from './types.js';

/** A calendar-date range, both ends inclusive (YYYY-MM-DD); an open end is unbounded. */
export interface DateRange {
  from?: string;
  to?: string;
}

export type PeriodPreset = 'week' | 'last30' | 'year';

/** The range of a preset, ending on `today`: this week (from Monday), the last 30 days, or this year. */
export function presetRange(preset: PeriodPreset, today: string): DateRange {
  switch (preset) {
    case 'week':
      return { from: addDays(today, 1 - weekdayOf(today)), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** Notes last edited within `range`, by the calendar date in `timeZone`. */
export function notesInRange(notes: EpisodeNote[], range: DateRange, timeZone: string): EpisodeNote[] {
  if (!range.from && !range.to) return notes;
  return notes.filter((n) => {
    const date = localDate(n.updatedAt, timeZone);
    return (!range.from || date >= range.from) && (!range.to || date <= range.to);
  });
}

export interface NoteGroup {
  showId: string;
  showName?: string;
  notes: EpisodeNote[];
}

/**
 * Groups notes by podcast. Groups are ordered by their most recently edited
 * note; inside a group, notes follow the episodes' release order (oldest
 * first). Notes without a known release date come last, newest edit first.
 */
export function groupNotesByShow(notes: EpisodeNote[]): NoteGroup[] {
  const groups = new Map<string, NoteGroup>();
  for (const note of notes) {
    const group = groups.get(note.showId) ?? { showId: note.showId, showName: note.showName, notes: [] };
    group.notes.push(note);
    groups.set(note.showId, group);
  }
  const lastEdit = (g: NoteGroup) => g.notes.reduce((max, n) => (n.updatedAt > max ? n.updatedAt : max), '');
  for (const group of groups.values()) group.notes.sort(byEpisode);
  return [...groups.values()].sort((a, b) => lastEdit(b).localeCompare(lastEdit(a)));
}

function byEpisode(a: EpisodeNote, b: EpisodeNote): number {
  if (a.episodeReleaseDate && b.episodeReleaseDate) {
    return a.episodeReleaseDate.localeCompare(b.episodeReleaseDate) || a.episodeId.localeCompare(b.episodeId);
  }
  if (a.episodeReleaseDate) return -1;
  if (b.episodeReleaseDate) return 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}
