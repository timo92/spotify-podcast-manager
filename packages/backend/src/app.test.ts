import { describe, expect, it } from 'vitest';
import type { Show, ShowDetailResponse, TodayResponse } from '@podcast/shared';
import { createApp } from './app.js';
import type { HttpRequest, HttpResponse } from './http/types.js';
import { SyncService } from './services/sync.js';
import { FakeSpotifyApi } from './spotify/fake.js';
import { MemoryStore } from './store/memory.js';

function setup(opts: { setupCode?: string; userId?: string } = {}) {
  const store = new MemoryStore();
  const spotify = new FakeSpotifyApi(new Date('2026-10-05T08:00:00Z'));
  const syncs: unknown[] = [];
  let userId = opts.userId ?? 'owner';
  const app = createApp({
    store,
    spotify,
    setupCode: opts.setupCode,
    triggerSync: async (o) => {
      syncs.push(o);
    },
    oauth: async () => ({
      tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000, scope: 'user-library-read' },
      user: { id: userId, display_name: 'Owner' },
    }),
  });
  let cookies: Record<string, string> = {};
  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const [p, qs] = path.split('?');
    const req: HttpRequest = {
      method,
      path: p,
      query: Object.fromEntries(new URLSearchParams(qs ?? '')),
      headers: { host: 'podcasts.example.com', ...(body !== undefined || method !== 'GET' ? { 'content-type': 'application/json' } : {}), ...headers },
      cookies,
      body,
    };
    const res = await app(req);
    for (const c of res.cookies ?? []) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (/Max-Age=0/.test(c)) delete cookies[k];
      else cookies[k] = decodeURIComponent(v);
    }
    return res;
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
    // demo flag is off, so credentials would be verified against Spotify – stub by pre-seeding instead
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
    expect(today.recommended.length + today.more.length).toBe(5);
    // Spotify reports an in-progress episode for "Sein und Streit".
    expect(today.recommended[0].label).toBe('WEITER');
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

  it('deletes all data', async () => {
    const t = await ready();
    expect((await t.call('DELETE', '/api/data')).status).toBe(200);
    expect(await t.store.listShows()).toHaveLength(0);
    expect(await t.store.getConfig()).toBeUndefined();
  });
});
