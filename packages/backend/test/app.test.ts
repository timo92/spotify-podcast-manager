import { describe, expect, it } from 'vitest';
import { localDate, weekdayOf, type Show, type ShowDetailResponse, type TodayResponse, type WeekResponse } from '@podcast/shared';
import { createApp } from '../src/app.js';
import { SyncService } from '../src/services/sync.js';
import { authorizeUrl } from '../src/spotify/client.js';
import { MemoryStore } from '../src/store/memory.js';
import { FakeSpotifyApi } from './fakes/fake-spotify.js';

interface TestResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

function setup(opts: { setupCode?: string; userId?: string } = {}) {
  const store = new MemoryStore();
  const spotify = new FakeSpotifyApi(new Date('2026-10-05T08:00:00Z'));
  const syncs: unknown[] = [];
  let userId = opts.userId ?? 'owner';
  const app = createApp({
    store,
    spotify: () => spotify,
    setupCode: opts.setupCode,
    triggerSync: async (o) => {
      syncs.push(o);
    },
    auth: {
      authorizeUrl,
      login: async () => ({
        tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000, scope: 'user-library-read' },
        user: { id: userId, display_name: 'Owner' },
      }),
      verifyCredentials: async () => {},
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
    sync: (full = false) => new SyncService(store, spotify).run({ full }),
  };
}

async function login(t: ReturnType<typeof setup>) {
  const res = await t.call('GET', '/api/auth/login');
  const state = new URL(res.headers!.Location).searchParams.get('state');
  return t.call('GET', `/api/auth/callback?code=x&state=${state}`);
}

const creds = { clientId: 'a'.repeat(32), clientSecret: 'b'.repeat(32) };

describe('setup and auth', () => {
  it('reports the redirect URI and requires a setup code', async () => {
    const t = setup({ setupCode: 'secret-code' });
    const status = (await t.call('GET', '/api/status')).body as { redirectUri: string; configured: boolean };
    expect(status.redirectUri).toBe('https://podcasts.example.com/api/auth/callback');
    expect(status.configured).toBe(false);

    const wrong = await t.call('POST', '/api/setup', { ...creds, setupCode: 'nope' });
    expect(wrong.status).toBe(403);
    const ok = await t.call('POST', '/api/setup', { ...creds, setupCode: 'secret-code' });
    expect(ok.status).toBe(200);
    expect((await t.store.getConfig())?.clientId).toBe(creds.clientId);
  });

  it('sets the session cookie HttpOnly, Secure and SameSite=Strict, the OAuth state cookie Lax', async () => {
    const t = setup();
    await t.store.putConfig({ ...creds, createdAt: '', updatedAt: '' });
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
    await t.store.putConfig({ ...creds, createdAt: '', updatedAt: '' });
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
    await t.store.putConfig({ ...creds, createdAt: '', updatedAt: '' });
    await t.call('GET', '/api/auth/login');
    const res = await t.call('GET', '/api/auth/callback?code=x&state=forged');
    expect(res.headers!.Location).toBe('/login?error=state_mismatch');
  });

  it('refuses re-setup once an owner exists', async () => {
    const t = setup();
    await t.store.putConfig({ ...creds, ownerId: 'owner', createdAt: '', updatedAt: '' });
    expect((await t.call('POST', '/api/setup', creds)).status).toBe(403);
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
    await t.store.putConfig({ ...creds, createdAt: '', updatedAt: '' });
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
    const original = t.spotify.getSavedShows.bind(t.spotify);
    t.spotify.getSavedShows = async () => (await original()).filter((s) => s.id !== 'demo-dertag');
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
      entries: [
        { showId: 'demo-wissensreise', weekday, part: 'EVENING' },
        { showId: 'demo-dertag', weekday, part: 'MORNING' },
        { showId: 'demo-wissensreise', weekday: tomorrow, part: 'ANYTIME' },
      ],
    });
    expect(res.status).toBe(200);
    expect((res.body as { entries: { id: string }[] }).entries.every((e) => e.id)).toBe(true);
    expect((await t.call('PUT', '/api/schedule', { entries: [{ showId: 'nope', weekday: 1 }] })).status).toBe(400);

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

  it('saves notes and flags episodes that have one', async () => {
    const t = await ready();
    const path = '/api/shows/demo-wissensreise/episodes/demo-wissensreise-1/note';
    expect((await t.call('GET', path)).body).toBeNull();
    const saved = await t.call('PUT', path, { text: '[02:10] Spannender Punkt' });
    expect(saved.status).toBe(200);
    expect((await t.call('GET', path)).body).toMatchObject({ text: '[02:10] Spannender Punkt', showName: 'Wissensreise' });
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
