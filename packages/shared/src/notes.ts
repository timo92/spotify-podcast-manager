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

/** Notes written within `range`, by the calendar date in `timeZone`. */
export function notesInRange(notes: EpisodeNote[], range: DateRange, timeZone: string): EpisodeNote[] {
  if (!range.from && !range.to) return notes;
  return notes.filter((n) => {
    const date = localDate(n.createdAt, timeZone);
    return (!range.from || date >= range.from) && (!range.to || date <= range.to);
  });
}

/**
 * Orders the notes of one episode: notes on the whole episode first, then by
 * position, and notes at the same position in the order they were written.
 */
export function byPosition(a: EpisodeNote, b: EpisodeNote): number {
  if (a.positionMs !== b.positionMs) {
    if (a.positionMs === null) return -1;
    if (b.positionMs === null) return 1;
    return a.positionMs - b.positionMs;
  }
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export interface NoteGroup {
  showId: string;
  showName?: string;
  notes: EpisodeNote[];
}

/**
 * Groups notes by podcast. Groups are ordered by their most recently written
 * note; inside a group, notes follow the episodes' release order (oldest
 * first) and, within an episode, their position (see byPosition). Episodes
 * without a known release date come last, most recently written first.
 */
export function groupNotesByShow(notes: EpisodeNote[]): NoteGroup[] {
  const groups = new Map<string, NoteGroup>();
  for (const note of notes) {
    const group = groups.get(note.showId) ?? { showId: note.showId, showName: note.showName, notes: [] };
    group.notes.push(note);
    groups.set(note.showId, group);
  }
  const latest = (list: EpisodeNote[]) => list.reduce((max, n) => (n.createdAt > max ? n.createdAt : max), '');
  for (const group of groups.values()) {
    const episodeLatest = new Map<string, string>();
    for (const n of group.notes) {
      if (n.createdAt > (episodeLatest.get(n.episodeId) ?? '')) episodeLatest.set(n.episodeId, n.createdAt);
    }
    group.notes.sort((a, b) => byEpisode(a, b, episodeLatest) || byPosition(a, b));
  }
  return [...groups.values()].sort((a, b) => latest(b.notes).localeCompare(latest(a.notes)));
}

function byEpisode(a: EpisodeNote, b: EpisodeNote, latest: Map<string, string>): number {
  if (a.episodeId === b.episodeId) return 0;
  if (a.episodeReleaseDate && b.episodeReleaseDate) {
    return a.episodeReleaseDate.localeCompare(b.episodeReleaseDate) || a.episodeId.localeCompare(b.episodeId);
  }
  if (a.episodeReleaseDate) return -1;
  if (b.episodeReleaseDate) return 1;
  return (latest.get(b.episodeId) ?? '').localeCompare(latest.get(a.episodeId) ?? '') || a.episodeId.localeCompare(b.episodeId);
}
