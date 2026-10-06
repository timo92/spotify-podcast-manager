import { describe, expect, it } from 'vitest';
import { buildEpisodeViews, buildToday, selectNextEpisode, summarizeShow } from '../src/logic.js';
import { guessCategories, guessMode } from '../src/heuristics.js';
import { DEFAULT_SETTINGS, type Episode, type EpisodeProgress, type EpisodeStatus, type Show } from '../src/types.js';

const now = new Date('2026-10-05T08:00:00Z');

function ep(id: string, releaseDate: string, minutes = 30, extra: Partial<Episode> = {}): Episode {
  return {
    id,
    showId: 's1',
    name: `Episode ${id}`,
    description: '',
    releaseDate,
    durationMs: minutes * 60_000,
    spotifyUrl: `https://open.spotify.com/episode/${id}`,
    firstSeenAt: now.toISOString(),
    lastSyncedAt: now.toISOString(),
    ...extra,
  };
}

function prog(episodeId: string, status: EpisodeProgress['status']): EpisodeProgress {
  return { showId: 's1', episodeId, status, updatedAt: now.toISOString(), listenedAt: now.toISOString() };
}

function show(extra: Partial<Show> = {}): Show {
  return {
    id: 's1',
    source: 'spotify',
    name: 'Show',
    description: '',
    spotifyUrl: '',
    mode: 'SEQUENTIAL',
    categories: [],
    paused: false,
    hiddenFromToday: false,
    priority: 1,
    reofferSkipped: false,
    needsReview: false,
    followed: true,
    createdAt: '',
    updatedAt: '',
    ...extra,
  };
}

const episodes = [ep('c', '2026-10-04'), ep('a', '2026-09-01'), ep('b', '2026-09-15')];

describe('buildEpisodeViews', () => {
  it('sorts chronologically and assigns indexes', () => {
    const views = buildEpisodeViews(episodes, new Map(), DEFAULT_SETTINGS, now);
    expect(views.map((v) => [v.id, v.index])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });

  it('marks recent unseen episodes as new', () => {
    const views = buildEpisodeViews(episodes, new Map(), DEFAULT_SETTINGS, now);
    expect(views.find((v) => v.id === 'c')!.isNew).toBe(true);
    expect(views.find((v) => v.id === 'a')!.isNew).toBe(false);
  });

  it('local progress beats Spotify state; Spotify played state needs opt-in', () => {
    const played = [ep('x', '2026-10-01', 30, { resumePoint: { fullyPlayed: true, resumePositionMs: 0 } })];
    const off = { ...DEFAULT_SETTINGS, useSpotifyPlayedState: false };
    expect(buildEpisodeViews(played, new Map(), off, now)[0]!.status).toBe('UNSEEN');
    expect(
      buildEpisodeViews(played, new Map(), { ...DEFAULT_SETTINGS, useSpotifyPlayedState: true }, now)[0]!.status,
    ).toBe('COMPLETED');
    const local = new Map([['x', prog('x', 'UNSEEN')]]);
    expect(buildEpisodeViews(played, local, { ...DEFAULT_SETTINGS, useSpotifyPlayedState: true }, now)[0]!.status).toBe(
      'UNSEEN',
    );
  });

  it('uses the Spotify resume point for in-progress and remaining time', () => {
    const half = [ep('x', '2026-10-01', 30, { resumePoint: { fullyPlayed: false, resumePositionMs: 10 * 60_000 } })];
    const [v] = buildEpisodeViews(half, new Map(), DEFAULT_SETTINGS, now);
    expect(v!.status).toBe('IN_PROGRESS');
    expect(v!.remainingMs).toBe(20 * 60_000);
  });
});

describe('selectNextEpisode', () => {
  it('SEQUENTIAL picks the oldest unfinished episode', () => {
    const views = buildEpisodeViews(episodes, new Map([['a', prog('a', 'COMPLETED')]]), DEFAULT_SETTINGS, now);
    expect(selectNextEpisode(show(), views)?.id).toBe('b');
  });

  it('SEQUENTIAL prefers an episode that is already in progress', () => {
    const views = buildEpisodeViews(
      episodes,
      new Map([['b', { ...prog('b', 'IN_PROGRESS'), listenedAt: undefined }]]),
      DEFAULT_SETTINGS,
      now,
    );
    expect(selectNextEpisode(show(), views)?.id).toBe('b');
  });

  it('SEQUENTIAL continues after the last finished episode, then fills gaps', () => {
    const four = [...episodes, ep('d', '2026-10-05')];
    const views = buildEpisodeViews(four, new Map([['b', prog('b', 'COMPLETED')]]), DEFAULT_SETTINGS, now);
    expect(selectNextEpisode(show(), views)?.id).toBe('c');
    const end = buildEpisodeViews(four, new Map([['d', prog('d', 'COMPLETED')]]), DEFAULT_SETTINGS, now);
    expect(selectNextEpisode(show(), end)?.id).toBe('a');
  });

  it('SEQUENTIAL ignores skipped episodes unless re-offering is enabled', () => {
    const p = new Map([
      ['a', prog('a', 'SKIPPED')],
      ['b', prog('b', 'COMPLETED')],
      ['c', prog('c', 'COMPLETED')],
    ]);
    const views = buildEpisodeViews(episodes, p, DEFAULT_SETTINGS, now);
    expect(selectNextEpisode(show(), views)).toBeNull();
    expect(selectNextEpisode(show({ reofferSkipped: true }), views)?.id).toBe('a');
  });

  it('SEQUENTIAL never suggests an episode Spotify no longer plays', () => {
    const gone = (id: string, date: string) => ep(id, date, 30, { isPlayable: false });
    const started = buildEpisodeViews(
      [gone('a', '2026-10-01'), ep('b', '2026-10-02')],
      new Map([['a', { ...prog('a', 'IN_PROGRESS'), listenedAt: undefined }]]),
      DEFAULT_SETTINGS,
      now,
    );
    expect(selectNextEpisode(show(), started)?.id).toBe('b');
    const skipped = buildEpisodeViews(
      [gone('a', '2026-10-01'), ep('b', '2026-10-02')],
      new Map([
        ['a', prog('a', 'SKIPPED')],
        ['b', prog('b', 'COMPLETED')],
      ]),
      DEFAULT_SETTINGS,
      now,
    );
    expect(selectNextEpisode(show({ reofferSkipped: true }), skipped)).toBeNull();
  });

  it('LATEST picks the newest episode', () => {
    const views = buildEpisodeViews(episodes, new Map(), DEFAULT_SETTINGS, now);
    expect(selectNextEpisode(show({ mode: 'LATEST' }), views)?.id).toBe('c');
    const done = buildEpisodeViews(episodes, new Map([['c', prog('c', 'COMPLETED')]]), DEFAULT_SETTINGS, now);
    expect(selectNextEpisode(show({ mode: 'LATEST' }), done)).toBeNull();
  });

  it('LATEST offers the newest unheard recent episode once the newest is heard', () => {
    // A daily show: the 4th is the newest, heard right away; the 3rd was never heard.
    const daily = [ep('d1', '2026-10-01'), ep('d2', '2026-10-02'), ep('d3', '2026-10-03'), ep('d4', '2026-10-04')];
    const latest = show({ mode: 'LATEST' });
    const pick = (p: [string, EpisodeStatus][]) =>
      selectNextEpisode(
        latest,
        buildEpisodeViews(daily, new Map(p.map(([id, st]) => [id, prog(id, st)])), DEFAULT_SETTINGS, now),
      )?.id;

    expect(pick([['d4', 'COMPLETED']])).toBe('d3');
    expect(
      pick([
        ['d4', 'COMPLETED'],
        ['d3', 'IN_PROGRESS'],
      ]),
    ).toBe('d3');
    expect(
      pick([
        ['d4', 'COMPLETED'],
        ['d3', 'SKIPPED'],
      ]),
    ).toBe('d2');
    expect(
      pick([
        ['d4', 'COMPLETED'],
        ['d3', 'COMPLETED'],
        ['d2', 'COMPLETED'],
        ['d1', 'COMPLETED'],
      ]),
    ).toBeUndefined();
  });

  it('LATEST leaves episodes older than the new window buried', () => {
    const views = buildEpisodeViews(
      episodes,
      new Map([['c', prog('c', 'COMPLETED')]]),
      { ...DEFAULT_SETTINGS, newWindowDays: 7 },
      now,
    );
    expect(selectNextEpisode(show({ mode: 'LATEST' }), views)).toBeNull();
    const wide = buildEpisodeViews(
      episodes,
      new Map([['c', prog('c', 'COMPLETED')]]),
      { ...DEFAULT_SETTINGS, newWindowDays: 30 },
      now,
    );
    expect(selectNextEpisode(show({ mode: 'LATEST' }), wide)?.id).toBe('b');
  });

  it('MANUAL only returns the pinned episode; pins override every mode', () => {
    const views = buildEpisodeViews(episodes, new Map(), DEFAULT_SETTINGS, now);
    expect(selectNextEpisode(show({ mode: 'MANUAL' }), views)).toBeNull();
    expect(selectNextEpisode(show({ mode: 'MANUAL', pinnedEpisodeId: 'b' }), views)?.id).toBe('b');
    expect(selectNextEpisode(show({ mode: 'LATEST', pinnedEpisodeId: 'a' }), views)?.id).toBe('a');
  });

  it('ignores a pin on a finished episode', () => {
    const views = buildEpisodeViews(episodes, new Map([['a', prog('a', 'COMPLETED')]]), DEFAULT_SETTINGS, now);
    expect(selectNextEpisode(show({ pinnedEpisodeId: 'a' }), views)?.id).toBe('b');
  });
});

describe('summarizeShow', () => {
  it('counts statuses', () => {
    const p = new Map([
      ['a', prog('a', 'COMPLETED')],
      ['b', prog('b', 'SKIPPED')],
    ]);
    const s = summarizeShow(show(), buildEpisodeViews(episodes, p, DEFAULT_SETTINGS, now), now);
    expect(s).toMatchObject({ total: 3, completed: 1, skipped: 1, unseen: 1, newCount: 1 });
    expect(s.nextEpisode?.id).toBe('c');
    expect(s.lastCompleted?.episodeId).toBe('a');
  });
});

describe('buildToday', () => {
  function withNext(id: string, name: string, minutes: number, priority: number, extra: Partial<Show> = {}): Show {
    const s = show({ id, name, priority, ...extra });
    const views = buildEpisodeViews([ep(`${id}-1`, '2026-10-04', minutes)], new Map(), DEFAULT_SETTINGS, now);
    s.summary = summarizeShow(s, views, now);
    return s;
  }

  it('fills the budget greedily in priority order', () => {
    const shows = [
      withNext('tag', 'Der Tag', 31, 1, { mode: 'LATEST' }),
      withNext('wr', 'Wissensreise', 18, 2),
      withNext('ss', 'Sein und Streit', 50, 3),
    ];
    const today = buildToday(shows, { ...DEFAULT_SETTINGS, audioBudgetMinutes: 30, budgetTolerancePercent: 0 });
    expect(today.recommended.map((r) => r.show.id)).toEqual(['wr']);
    expect(today.more.map((r) => r.show.id)).toEqual(['tag', 'ss']);
    expect(today.recommended[0]!.label).toBe('NAECHSTE');
  });

  it('respects tolerance, paused and hidden shows', () => {
    const shows = [
      withNext('tag', 'Der Tag', 31, 1, { mode: 'LATEST' }),
      withNext('p', 'Paused', 5, 0, { paused: true }),
      withNext('h', 'Hidden', 5, 0, { hiddenFromToday: true }),
    ];
    const today = buildToday(shows, { ...DEFAULT_SETTINGS, audioBudgetMinutes: 30, budgetTolerancePercent: 10 });
    expect(today.recommended.map((r) => r.show.id)).toEqual(['tag']);
    expect(today.recommended[0]!.label).toBe('NEU');
    expect(today.budgetFit).toBe('slightlyOver');
    expect(today.more).toHaveLength(0);
  });

  it('counts new episodes only of podcasts still in the library', () => {
    const shows = [withNext('a', 'A', 10, 1), withNext('gone', 'Gone', 10, 2, { followed: false })];
    expect(buildToday(shows, DEFAULT_SETTINGS).newCount).toBe(1);
  });

  it('rates the budget by the tolerance the user set', () => {
    const fit = (minutes: number, budgetTolerancePercent: number) =>
      buildToday([withNext('a', 'A', minutes, 1)], {
        ...DEFAULT_SETTINGS,
        audioBudgetMinutes: 30,
        budgetTolerancePercent,
      }).budgetFit;
    expect(fit(20, 10)).toBe('under');
    expect(fit(30, 10)).toBe('perfect');
    expect(fit(40, 50)).toBe('slightlyOver');
    // beyond the tolerance the episode isn't recommended, so there is nothing to rate
    expect(fit(40, 10)).toBe('none');
  });

  it('lists LATEST shows without a new episode', () => {
    const s = show({ id: 'n', mode: 'LATEST' });
    s.summary = summarizeShow(s, [], now);
    expect(buildToday([s], DEFAULT_SETTINGS).noNewEpisode.map((x) => x.id)).toEqual(['n']);
  });
});

describe('heuristics', () => {
  it('guesses LATEST for frequently published shows', () => {
    const daily = Array.from({ length: 10 }, (_, i) => ({ releaseDate: `2026-09-${String(10 + i).padStart(2, '0')}` }));
    const monthly = Array.from({ length: 10 }, (_, i) => ({
      releaseDate: `2025-${String(i + 1).padStart(2, '0')}-01`,
    }));
    expect(guessMode(daily)).toBe('LATEST');
    expect(guessMode(monthly)).toBe('SEQUENTIAL');
    expect(guessMode(monthly, 'Die Nachrichten des Tages')).toBe('LATEST');
  });

  it('guesses categories from the name first', () => {
    const known = DEFAULT_SETTINGS.categories;
    expect(guessCategories('Der Rest ist Geschichte', 'Ein Podcast über Politik', known)).toEqual([
      'Geschichte',
      'Politik',
    ]);
    expect(guessCategories('Irgendwas', '', known)).toEqual(['Sonstiges']);
  });
});
