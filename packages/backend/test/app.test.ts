import { describe, expect, it } from 'vitest';
import { localDate, weekdayOf, type AppStatus, type Schedule, type Show, type SyncState, type ShowDetailResponse, type TodayResponse, type WeekResponse } from '@podcast/shared';
import { createApp } from '../src/app.js';
import { SyncService, type SyncOptions } from '../src/services/sync.js';
import { authorizeUrl } from '../src/spotify/client.js';
import { staticCredentials, type SpotifyCredentialsProvider } from '../src/spotify/credentials.js';
import { MemoryStore } from '../src/store/memory.js';
import { credentialsFromEnv } from '../src/spotify/credentials.js';
import { FakeSpotifyApi } from './fakes/fake-spotify.js';

const CLIENT_ID = 'a'.repeat(32);

interface TestResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

function setup(opts: { userId?: string; credentials?: SpotifyCredentialsProvider; triggerFails?: boolean } = {}) {
  const store = new MemoryStore();
  const spotify = new FakeSpotifyApi(new Date('2026-10-05T08:00:00Z'));
  const syncs: SyncOptions[] = [];
  // Runs the API triggered but not yet executed, like the async sync Lambda would.
  const pending: SyncOptions[] = [];
  let userId = opts.userId ?? 'owner';
  const app = createApp({
    store,
    spotify: () => spotify,
    credentials: opts.credentials ?? staticCredentials(CLIENT_ID, 'b'.repeat(32)),
    triggerSync: async (o) => {
      if (opts.triggerFails) throw new Error('Lambda invoke failed');
      syncs.push(o);
      pending.push(o);
    },
    auth: {
      authorizeUrl,
      login: async () => ({
        tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000, scope: 'user-library-read' },
        user: { id: userId, display_name: 'Owner' },
      }),
    },
  });
  let cookies: Record<string, string> = {};
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<TestResponse> {
    const res = await app.request(path, {
      method,
      headers: {
        host: 'podcasts.example.com',
        ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
        cookie: Object.entries(cookies)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join('; '),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (/Max-Age=0/i.test(c)) delete cookies[k];
      else cookies[k] = decodeURIComponent(v);
    }
    const text = await res.text();
    return {
      status: res.status,
      headers: Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k === 'location' ? 'Location' : k, v])),
      body: text ? JSON.parse(text) : undefined,
    };
  }
  return {
    store,
    spotify,
    syncs,
    call,
    setUser: (id: string) => (userId = id),
    clearCookies: () => (cookies = {}),
    sync: (full = false) => {
      const triggered = pending.shift();
      return new SyncService(store, spotify).run(triggered ? { ...triggered, full: full || triggered.full } : { full });
    },
  };
}

async function login(t: ReturnType<typeof setup>) {
  const res = await t.call('GET', '/api/auth/login');
  const state = new URL(res.headers!.Location).searchParams.get('state');
  return t.call('GET', `/api/auth/callback?code=x&state=${state}`);
}

describe('configuration and auth', () => {
  it('reports the redirect URI and whether the deployment provides credentials', async () => {
    const t = setup();
    const status = (await t.call('GET', '/api/status')).body as AppStatus;
    expect(status).toMatchObject({
      configured: true,
      claimed: false,
      redirectUri: 'https://podcasts.example.com/api/auth/callback',
    });
    const login = await t.call('GET', '/api/auth/login');
    expect(new URL(login.headers.Location).searchParams.get('client_id')).toBe(CLIENT_ID);
  });

  it('explains a missing client ID instead of starting the login', async () => {
    const t = setup({ credentials: credentialsFromEnv({}) });
    expect(((await t.call('GET', '/api/status')).body as AppStatus).configured).toBe(false);
    expect((await t.call('GET', '/api/auth/login')).headers.Location).toBe('/login?error=not_configured');
  });

  it('sets the session cookie HttpOnly, Secure and SameSite=Strict, the OAuth state cookie Lax', async () => {
    const t = setup();
    const start = await t.call('GET', '/api/auth/login');
    expect(start.headers['set-cookie']).toMatch(/pm_oauth_state=[^;]+;.*SameSite=Lax/i);
    const res = await login(t);
    const session = res.headers['set-cookie'].split(/,\s*(?=pm_)/).find((c) => c.startsWith('pm_session='))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/Secure/i);
    expect(session).toMatch(/SameSite=Strict/i);
  });

  it('binds the owner on first login and rejects other accounts', async () => {
    const t = setup();
    const res = await login(t);
    expect(res.status).toBe(302);
    expect(res.headers!.Location).toBe('/?welcome=1');
    expect(t.syncs).toHaveLength(1);
    expect((await t.store.getConfig())!.ownerId).toBe('owner');
    expect((await t.call('GET', '/api/today')).status).toBe(200);

    t.clearCookies();
    t.setUser('intruder');
    const bad = await login(t);
    expect(bad.headers!.Location).toBe('/login?error=wrong_account');
    expect((await t.call('GET', '/api/today')).status).toBe(401);
  });

  it('rejects a callback with a wrong state', async () => {
    const t = setup();
    await t.call('GET', '/api/auth/login');
    const res = await t.call('GET', '/api/auth/callback?code=x&state=forged');
    expect(res.headers!.Location).toBe('/login?error=state_mismatch');
  });

  it('frees the lease when the sync cannot be started, without failing the login', async () => {
    const t = setup({ triggerFails: true });
    const res = await login(t); // first login tries to start the initial import
    expect(res.headers.Location).toBe('/?welcome=1');
    const state = await t.store.getSyncState();
    expect(state.status).toBe('error');
    expect(state.leaseId).toBeUndefined();
    // the button reports the failure, and nothing stays blocked
    expect((await t.call('POST', '/api/sync', {})).status).toBe(500);
    expect((await t.store.getSyncState()).leaseId).toBeUndefined();
  });

  it('never runs two syncs at once', async () => {
    const t = setup();
    await login(t); // the first login starts the initial import
    expect(t.syncs).toHaveLength(1);
    const lease = t.syncs[0].leaseId;
    expect(lease).toBeDefined();

    // A second click while it runs neither triggers nor steals the lease.
    const again = await t.call('POST', '/api/sync', { full: true });
    expect(again.status).toBe(202);
    expect((again.body as SyncState).status).toBe('running');
    expect(t.syncs).toHaveLength(1);

    // A scheduled run without the lease is skipped and leaves the state alone.
    const scheduled = await new SyncService(t.store, t.spotify).run({ full: true });
    expect(scheduled.leaseId).toBe(lease);
    expect(await t.store.listShows()).toHaveLength(0);

    // The triggered run takes its lease over, imports, and frees it.
    const done = await t.sync();
    expect(done.status).toBe('idle');
    expect((await t.store.getSyncState()).leaseId).toBeUndefined();
    expect(await t.store.listShows()).toHaveLength(5);

    // Afterwards a new sync can start.
    await t.call('POST', '/api/sync', {});
    expect(t.syncs).toHaveLength(2);
  });

  it('requires JSON for mutating requests', async () => {
    const t = setup();
    const res = await t.call('POST', '/api/auth/logout', undefined, { 'content-type': 'text/plain' });
    expect(res.status).toBe(415);
  });
});

describe('library flow', () => {
  async function ready() {
    const t = setup();
    await login(t);
    const state = await t.sync();
    expect(state.status).toBe('idle');
    return t;
  }

  it('imports shows with guessed modes and builds today', async () => {
    const t = await ready();
    const shows = (await t.call('GET', '/api/shows')).body as Show[];
    expect(shows).toHaveLength(5);
    const tag = shows.find((s) => s.name === 'Der Tag')!;
    expect(tag.mode).toBe('LATEST');
    expect(tag.categories).toContain('Nachrichten');
    expect(tag.needsReview).toBe(true);
    expect(shows.find((s) => s.name === 'Sein und Streit')!.mode).toBe('SEQUENTIAL');

    const today = (await t.call('GET', '/api/today')).body as TodayResponse;
    const items = [...today.recommended, ...today.more];
    expect(items).toHaveLength(5);
    // New shows are ordered news-first.
    expect(items[0].show.mode).toBe('LATEST');
    // Spotify reports episodes 1–2 as played and 3 as started for "Sein und Streit".
    const sus = items.find((i) => i.show.name === 'Sein und Streit')!;
    expect(sus.label).toBe('WEITER');
    expect(sus.episode.index).toBe(3);
  });

  it('marks episodes and advances sequential shows', async () => {
    const t = await ready();
    const id = 'demo-wissensreise';
    let detail = (await t.call('GET', `/api/shows/${id}`)).body as ShowDetailResponse;
    expect(detail.show.summary!.nextEpisode!.id).toBe(`${id}-1`);

    await t.call('PUT', `/api/shows/${id}/episodes/${id}-1/status`, { status: 'COMPLETED' });
    await t.call('PUT', `/api/shows/${id}/episodes/${id}-2/status`, { status: 'SKIPPED' });
    detail = (await t.call('GET', `/api/shows/${id}`)).body as ShowDetailResponse;
    expect(detail.show.summary!.nextEpisode!.id).toBe(`${id}-3`);

    await t.call('POST', `/api/shows/${id}/episodes/${id}-10/complete-before`, {});
    detail = (await t.call('GET', `/api/shows/${id}`)).body as ShowDetailResponse;
    expect(detail.show.summary!.nextEpisode!.id).toBe(`${id}-10`);
    expect(detail.show.summary!.completed).toBe(8);
    expect(detail.show.summary!.skipped).toBe(1);

    // pin an episode, then sync again: personal state must survive
    await t.call('PATCH', `/api/shows/${id}`, { pinnedEpisodeId: `${id}-20`, mode: 'MANUAL', categories: ['Geographie'] });
    await t.sync(true);
    const show = (await t.call('GET', `/api/shows/${id}`)).body as ShowDetailResponse;
    expect(show.show.mode).toBe('MANUAL');
    expect(show.show.categories).toEqual(['Geographie']);
    expect(show.show.summary!.nextEpisode!.id).toBe(`${id}-20`);
    expect(show.show.summary!.completed).toBe(8);

    const history = (await t.call('GET', '/api/history')).body as unknown[];
    expect(history).toHaveLength(8);
  });

  it('respects the Spotify played-state setting', async () => {
    const t = await ready();
    const id = 'demo-restgeschichte';
    await t.call('PUT', '/api/settings', { useSpotifyPlayedState: false });
    let detail = (await t.call('GET', `/api/shows/${id}`)).body as ShowDetailResponse;
    expect(detail.show.summary!.completed).toBe(0);
    expect(detail.show.summary!.nextEpisode!.id).toBe(`${id}-1`);
    await t.call('PUT', '/api/settings', { useSpotifyPlayedState: true });
    detail = (await t.call('GET', `/api/shows/${id}`)).body as ShowDetailResponse;
    expect(detail.show.summary!.completed).toBe(2);
    expect(detail.show.summary!.nextEpisode!.id).toBe(`${id}-3`);
  });

  it('marks shows removed from the Spotify library as unfollowed', async () => {
    const t = await ready();
    t.spotify.saved.delete('demo-dertag');
    await t.sync();
    const tag = (await t.call('GET', '/api/shows/demo-dertag')).body as ShowDetailResponse;
    expect(tag.show.followed).toBe(false);
    const today = (await t.call('GET', '/api/today')).body as TodayResponse;
    expect([...today.recommended, ...today.more].some((i) => i.show.id === 'demo-dertag')).toBe(false);
  });

  it('plans the week and puts today\'s slots on top of Heute', async () => {
    const t = await ready();
    const tz = 'Europe/Berlin';
    const weekday = weekdayOf(localDate(Date.now(), tz));
    const tomorrow = (weekday % 7) + 1;
    const res = await t.call('PUT', '/api/schedule', {
      rules: [
        { showId: 'demo-wissensreise', weekdays: [weekday], part: 'EVENING' },
        { showId: 'demo-dertag', weekdays: [weekday], part: 'MORNING' },
        { showId: 'demo-wissensreise', weekdays: [tomorrow], part: 'ANYTIME' },
      ],
    });
    expect(res.status).toBe(200);
    expect((res.body as Schedule).rules.every((r) => r.id)).toBe(true);

    const week = (await t.call('GET', `/api/week?tz=${tz}`)).body as WeekResponse;
    expect(week.days).toHaveLength(7);
    expect(week.days[0].isToday).toBe(true);
    expect(week.days[0].items.map((i) => [i.show.id, i.state])).toEqual([
      ['demo-dertag', 'next'],
      ['demo-wissensreise', 'next'],
    ]);
    expect(week.days[1].items[0].episode?.id).toBe('demo-wissensreise-2');

    let today = (await t.call('GET', `/api/today?tz=${tz}`)).body as TodayResponse;
    expect(today.plan.map((p) => p.show.id)).toEqual(['demo-dertag', 'demo-wissensreise']);
    expect([...today.recommended, ...today.more].some((i) => i.show.id === 'demo-dertag')).toBe(false);

    // Finishing the planned episode ticks the slot off instead of advancing it.
    await t.call('PUT', '/api/shows/demo-wissensreise/episodes/demo-wissensreise-1/status', { status: 'COMPLETED' });
    today = (await t.call('GET', `/api/today?tz=${tz}`)).body as TodayResponse;
    const slot = today.plan.find((p) => p.show.id === 'demo-wissensreise')!;
    expect([slot.state, slot.episode?.id]).toEqual(['done', 'demo-wissensreise-1']);
    const nextWeek = (await t.call('GET', `/api/week?tz=${tz}`)).body as WeekResponse;
    expect(nextWeek.days[1].items[0].episode?.id).toBe('demo-wissensreise-2');
  });

  it('validates plan rules', async () => {
    const t = await ready();
    const save = (body: unknown) => t.call('PUT', '/api/schedule', body);
    expect((await save({ rules: [{ weekdays: [1] }] })).status).toBe(400);
    expect((await save({ rules: [{ showId: 'demo-dertag', weekdays: [] }] })).status).toBe(400);
    expect((await save({ rules: [{ showId: 'demo-dertag', weekdays: [8] }] })).status).toBe(400);
    expect((await save({ rules: 'x' })).status).toBe(400);
    expect((await save({ entries: [null] })).status).toBe(400);

    const res = await save({
      rules: [
        { id: 'same', showId: 'demo-dertag', weekdays: [5, 1, 1], part: 'NIGHT' },
        { id: 'same', showId: 'demo-wissensreise', weekdays: [2], part: 'EVENING' },
      ],
    });
    expect(res.status).toBe(200);
    const [first, second] = (res.body as Schedule).rules;
    expect(first).toEqual({ id: 'same', showId: 'demo-dertag', weekdays: [1, 5], part: 'ANYTIME' });
    expect(second.id).not.toBe('same');
  });

  it('accepts a plan in the legacy slot shape', async () => {
    const t = await ready();
    const res = await t.call('PUT', '/api/schedule', {
      entries: [
        { id: 'a', showId: 'demo-dertag', weekday: 1, part: 'MORNING' },
        { id: 'b', showId: 'demo-dertag', weekday: 3, part: 'MORNING' },
      ],
    });
    expect(res.status).toBe(200);
    const rules = [{ id: 'a', showId: 'demo-dertag', weekdays: [1, 3], part: 'MORNING' }];
    expect((await t.call('GET', '/api/schedule')).body).toMatchObject({ rules });
    expect(((await t.call('GET', '/api/export')).body as { schedule: Schedule }).schedule).toMatchObject({ rules });
  });

  it('drops plan rules of podcasts that no longer exist instead of rejecting the save', async () => {
    const t = await ready();
    const res = await t.call('PUT', '/api/schedule', {
      rules: [
        { showId: 'demo-wissensreise', weekdays: [1], part: 'MORNING' },
        { showId: 'deleted-meanwhile', weekdays: [2], part: 'EVENING' },
      ],
    });
    expect(res.status).toBe(200);
    expect((res.body as Schedule).rules.map((r) => r.showId)).toEqual(['demo-wissensreise']);
  });

  it('saves notes and flags episodes that have one', async () => {
    const t = await ready();
    const path = '/api/shows/demo-wissensreise/episodes/demo-wissensreise-1/note';
    expect((await t.call('GET', path)).body).toBeNull();
    const saved = await t.call('PUT', path, { text: '[02:10] Spannender Punkt' });
    expect(saved.status).toBe(200);
    expect((await t.call('GET', path)).body).toMatchObject({
      text: '[02:10] Spannender Punkt',
      showName: 'Wissensreise',
      episodeReleaseDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}/),
    });
    const detail = (await t.call('GET', '/api/shows/demo-wissensreise')).body as ShowDetailResponse;
    expect(detail.episodes.find((e) => e.id === 'demo-wissensreise-1')!.hasNote).toBe(true);
    expect(((await t.call('GET', '/api/notes')).body as unknown[]).length).toBe(1);
    // Emptying a note deletes it.
    await t.call('PUT', path, { text: '  ' });
    expect((await t.call('GET', '/api/notes')).body).toEqual([]);
    expect((await t.call('PUT', '/api/shows/demo-wissensreise/episodes/nope/note', { text: 'x' })).status).toBe(404);
  });

  it('deletes all data', async () => {
    const t = await ready();
    expect((await t.call('DELETE', '/api/data')).status).toBe(200);
    expect(await t.store.listShows()).toHaveLength(0);
    expect(await t.store.getConfig()).toBeUndefined();
  });
});
