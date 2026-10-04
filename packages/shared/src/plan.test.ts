import { describe, expect, it } from 'vitest';
import { buildEpisodeViews, buildToday, summarizeShow } from './logic.js';
import { addDays, buildWeek, localDate, weekdayOf, type PlanInput } from './plan.js';
import { DEFAULT_SETTINGS, type Episode, type EpisodeProgress, type Schedule, type Show } from './types.js';

const now = new Date('2026-10-05T08:00:00Z'); // a Monday

function eps(showId: string, n: number, minutes = 30): Episode[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${showId}-${i + 1}`,
    showId,
    name: `${showId} ${i + 1}`,
    description: '',
    releaseDate: addDays('2026-09-01', i),
    durationMs: minutes * 60_000,
    spotifyUrl: '',
    firstSeenAt: '',
    lastSyncedAt: '',
  }));
}

function show(id: string, mode: Show['mode']): Show {
  return {
    id,
    source: 'spotify',
    name: id,
    description: '',
    spotifyUrl: '',
    mode,
    categories: [],
    paused: false,
    hiddenFromToday: false,
    priority: 1,
    reofferSkipped: false,
    needsReview: false,
    followed: true,
    createdAt: '',
    updatedAt: '',
  };
}

function input(s: Show, episodes: Episode[], progress: EpisodeProgress[] = [], doneToday: string[] = []): PlanInput {
  const views = buildEpisodeViews(episodes, new Map(progress.map((p) => [p.episodeId, p])), DEFAULT_SETTINGS, now);
  return { show: s, views, doneToday: views.filter((v) => doneToday.includes(v.id)) };
}

const completed = (showId: string, id: string): EpisodeProgress => ({
  showId,
  episodeId: id,
  status: 'COMPLETED',
  listenedAt: now.toISOString(),
  updatedAt: now.toISOString(),
});

describe('dates', () => {
  it('computes weekdays and local dates', () => {
    expect(weekdayOf('2026-10-05')).toBe(1);
    expect(weekdayOf('2026-10-11')).toBe(7);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(localDate('2026-10-04T23:30:00Z', 'Europe/Berlin')).toBe('2026-10-05');
    expect(localDate('2026-10-04T23:30:00Z', 'UTC')).toBe('2026-10-04');
  });
});

describe('buildWeek', () => {
  const schedule: Schedule = {
    entries: [
      { id: '1', showId: 'series', weekday: 1, part: 'EVENING' },
      { id: '2', showId: 'news', weekday: 1, part: 'MORNING' },
      { id: '3', showId: 'series', weekday: 3, part: 'EVENING' },
      { id: '4', showId: 'news', weekday: 2, part: 'MORNING' },
      { id: '5', showId: 'series', weekday: 1, part: 'EVENING' },
    ],
  };

  it('projects series episodes across the week in order', () => {
    const inputs = new Map([
      ['series', input(show('series', 'SEQUENTIAL'), eps('series', 10), [completed('series', 'series-1')])],
      ['news', input(show('news', 'LATEST'), eps('news', 5))],
    ]);
    const week = buildWeek('2026-10-05', '2026-10-05', 7, schedule, inputs);
    expect(week).toHaveLength(7);
    const [mon, tue, wed] = week;
    expect(mon.isToday).toBe(true);
    // ordered by part of day
    expect(mon.items.map((i) => [i.show.id, i.state, i.episode?.id])).toEqual([
      ['news', 'next', 'news-5'],
      ['series', 'next', 'series-2'],
      ['series', 'upcoming', 'series-3'],
    ]);
    expect(tue.items.map((i) => [i.show.id, i.state])).toEqual([['news', 'latest']]);
    expect(wed.items.map((i) => i.episode?.id)).toEqual(['series-4']);
    expect(mon.openMs).toBe(90 * 60_000);
  });

  it('turns slots into "done" for episodes finished today', () => {
    const inputs = new Map([
      [
        'series',
        input(show('series', 'SEQUENTIAL'), eps('series', 10), [completed('series', 'series-1')], ['series-1']),
      ],
      ['news', input(show('news', 'LATEST'), eps('news', 5), [completed('news', 'news-5')], ['news-5'])],
    ]);
    const [mon, , wed] = buildWeek('2026-10-05', '2026-10-05', 7, schedule, inputs);
    expect(mon.items.map((i) => [i.show.id, i.state, i.episode?.id])).toEqual([
      ['news', 'done', 'news-5'],
      ['series', 'done', 'series-1'],
      ['series', 'next', 'series-2'],
    ]);
    expect(wed.items[0].episode?.id).toBe('series-3');
  });

  it('marks shows with nothing left', () => {
    const inputs = new Map([['news', input(show('news', 'MANUAL'), eps('news', 2))]]);
    const [mon] = buildWeek('2026-10-05', '2026-10-05', 1, schedule, inputs);
    expect(mon.items[0].state).toBe('none');
  });
});

describe('buildToday with a plan', () => {
  it('counts planned episodes against the budget and does not repeat them', () => {
    const series = show('series', 'SEQUENTIAL');
    const other = show('other', 'SEQUENTIAL');
    const inputs = new Map([['series', input(series, eps('series', 3, 20))]]);
    series.summary = summarizeShow(series, inputs.get('series')!.views, now);
    other.summary = summarizeShow(other, buildEpisodeViews(eps('other', 3, 15), new Map(), DEFAULT_SETTINGS, now), now);
    const [mon] = buildWeek('2026-10-05', '2026-10-05', 1, { entries: [{ id: 'x', showId: 'series', weekday: 1, part: 'ANYTIME' }] }, inputs);
    const today = buildToday([series, other], { ...DEFAULT_SETTINGS, audioBudgetMinutes: 30, budgetTolerancePercent: 0 }, [], mon.items);
    expect(today.plan).toHaveLength(1);
    expect(today.recommended).toHaveLength(0);
    expect(today.more.map((m) => m.show.id)).toEqual(['other']);
    expect(today.recommendedMinutes).toBe(20);
  });
});
