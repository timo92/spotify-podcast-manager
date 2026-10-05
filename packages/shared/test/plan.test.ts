import { describe, expect, it } from 'vitest';
import { buildEpisodeViews, buildToday, summarizeShow } from '../src/logic.js';
import {
  addDays,
  buildWeek,
  localDate,
  removeRule,
  removeWeekday,
  replaceRule,
  weekdayOf,
  type PlanInput,
} from '../src/plan.js';
import { DEFAULT_SETTINGS, type Episode, type EpisodeProgress, type Schedule, type Show } from '../src/types.js';

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
    rules: [
      { id: '1', showId: 'series', weekdays: [1, 3], part: 'EVENING' },
      { id: '2', showId: 'news', weekdays: [1, 2], part: 'MORNING' },
      { id: '5', showId: 'series', weekdays: [1], part: 'EVENING' },
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

  it('shows the chosen episode of a manual show in every slot', () => {
    const manual = show('manual', 'MANUAL');
    manual.pinnedEpisodeId = 'manual-2';
    const twice: Schedule = {
      rules: [
        { id: 'a', showId: 'manual', weekdays: [2], part: 'MORNING' },
        { id: 'b', showId: 'manual', weekdays: [4], part: 'EVENING' },
      ],
    };
    const inputs = new Map([['manual', input(manual, eps('manual', 3))]]);
    const [, tue, , thu] = buildWeek('2026-10-05', '2026-10-05', 7, twice, inputs);
    expect(tue.items.map((i) => [i.state, i.episode?.id])).toEqual([['next', 'manual-2']]);
    expect(thu.items.map((i) => [i.state, i.episode?.id])).toEqual([['next', 'manual-2']]);
  });

  it('shows the newest episode of a news show in every slot of today, counting it once', () => {
    const twice: Schedule = {
      rules: [
        { id: 'a', showId: 'news', weekdays: [1], part: 'MORNING' },
        { id: 'b', showId: 'news', weekdays: [1], part: 'EVENING' },
      ],
    };
    const inputs = new Map([['news', input(show('news', 'LATEST'), eps('news', 5))]]);
    const [mon] = buildWeek('2026-10-05', '2026-10-05', 1, twice, inputs);
    expect(mon.items.map((i) => [i.state, i.episode?.id])).toEqual([
      ['next', 'news-5'],
      ['next', 'news-5'],
    ]);
    expect(mon.openMs).toBe(30 * 60_000);
  });

  it('ticks off only one slot when a repeated episode was heard today', () => {
    const twice: Schedule = {
      rules: [
        { id: 'a', showId: 'news', weekdays: [1], part: 'MORNING' },
        { id: 'b', showId: 'news', weekdays: [1], part: 'EVENING' },
      ],
    };
    const inputs = new Map([
      ['news', input(show('news', 'LATEST'), eps('news', 5), [completed('news', 'news-5')], ['news-5'])],
    ]);
    const [mon] = buildWeek('2026-10-05', '2026-10-05', 1, twice, inputs);
    expect(mon.items.map((i) => [i.state, i.episode?.id])).toEqual([
      ['done', 'news-5'],
      ['none', undefined],
    ]);
  });

  it('marks shows with nothing left', () => {
    const inputs = new Map([['news', input(show('news', 'MANUAL'), eps('news', 2))]]);
    const [mon] = buildWeek('2026-10-05', '2026-10-05', 1, schedule, inputs);
    expect(mon.items[0].state).toBe('none');
  });
});

describe('rule edits', () => {
  const rules: Schedule['rules'] = [
    { id: 'a', showId: 'news', weekdays: [1, 3], part: 'MORNING' },
    { id: 'b', showId: 'series', weekdays: [2], part: 'EVENING' },
  ];

  it('replaces and removes rules', () => {
    const changed = { ...rules[0], weekdays: [5 as const] };
    expect(replaceRule(rules, changed)).toEqual([changed, rules[1]]);
    expect(removeRule(rules, 'a')).toEqual([rules[1]]);
  });

  it('removes a weekday, and the rule with its last weekday', () => {
    expect(removeWeekday(rules, 'a', 3)).toEqual([{ ...rules[0], weekdays: [1] }, rules[1]]);
    expect(removeWeekday(rules, 'b', 2)).toEqual([rules[0]]);
  });
});

describe('buildToday with a plan', () => {
  it('counts planned episodes against the budget and does not repeat them', () => {
    const series = show('series', 'SEQUENTIAL');
    const other = show('other', 'SEQUENTIAL');
    const inputs = new Map([['series', input(series, eps('series', 3, 20))]]);
    series.summary = summarizeShow(series, inputs.get('series')!.views, now);
    other.summary = summarizeShow(other, buildEpisodeViews(eps('other', 3, 15), new Map(), DEFAULT_SETTINGS, now), now);
    const [mon] = buildWeek('2026-10-05', '2026-10-05', 1, { rules: [{ id: 'x', showId: 'series', weekdays: [1], part: 'ANYTIME' }] }, inputs);
    const today = buildToday([series, other], { ...DEFAULT_SETTINGS, audioBudgetMinutes: 30, budgetTolerancePercent: 0 }, [], mon.items);
    expect(today.plan).toHaveLength(1);
    expect(today.recommended).toHaveLength(0);
    expect(today.more.map((m) => m.show.id)).toEqual(['other']);
    expect(today.recommendedMinutes).toBe(20);
  });

  it('counts an episode planned in several slots once', () => {
    const manual = show('manual', 'MANUAL');
    manual.pinnedEpisodeId = 'manual-1';
    const inputs = new Map([['manual', input(manual, eps('manual', 2, 20))]]);
    const twice: Schedule = {
      rules: [
        { id: 'a', showId: 'manual', weekdays: [1], part: 'MORNING' },
        { id: 'b', showId: 'manual', weekdays: [1], part: 'EVENING' },
      ],
    };
    const [mon] = buildWeek('2026-10-05', '2026-10-05', 1, twice, inputs);
    const today = buildToday([manual], DEFAULT_SETTINGS, [], mon.items);
    expect(today.plan).toHaveLength(2);
    expect(today.recommendedMinutes).toBe(20);
  });
});
