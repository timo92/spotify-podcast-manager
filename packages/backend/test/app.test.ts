import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  localDate,
  weekdayOf,
  type AppStatus,
  type EpisodeNote,
  type EpisodeView,
  type PlaybackState,
  type Schedule,
  type Show,
  type SyncState,
  type ShowDetailResponse,
  type TodayResponse,
  type WeekResponse,
} from '@podcast/shared';
import { StatusCodes } from 'http-status-codes';
import { createApp } from '../src/app.js';
import { ApiError } from '../src/errors.js';
import { acquireSyncLease, STALE_SYNC_MS, SyncService, type SyncOptions } from '../src/services/sync.js';
import { spotifyAuth, type SpotifyAuth } from '../src/spotify/auth.js';
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

function setup(
  opts: {
    userId?: string;
    credentials?: SpotifyCredentialsProvider;
    triggerFails?: boolean;
    /** The OAuth login; a fake that logs in `userId` by default. */
    auth?: SpotifyAuth;
  } = {},
) {
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
    auth: opts.auth ?? {
      authorizeUrl,
      login: async () => ({
        tokens: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000, scope: 'user-library-read' },
        user: { id: userId, display_name: 'Owner' },
      }),
    },
  });
  let cookies: Record<string, string> = {};
  /** `body` is sent as JSON; a string is sent as it is, to test malformed input. */
  async function call(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
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
      body: typeof body === 'string' ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair = ''] = c.split(';');
      const [k = '', v = ''] = pair.split('=');
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
  const state = new URL(res.headers.Location!).searchParams.get('state');
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
    const redirect = await t.call('GET', '/api/auth/login');
    expect(new URL(redirect.headers.Location!).searchParams.get('client_id')).toBe(CLIENT_ID);
  });

  it('refuses requests that bypass CloudFront', async () => {
    const app = createApp({
      store: new MemoryStore(),
      spotify: () => new FakeSpotifyApi(),
      credentials: staticCredentials(CLIENT_ID, 'b'.repeat(32)),
      triggerSync: async () => {},
      originSecret: 'from-cloudfront',
    });
    const direct = await app.request('/api/status');
    expect(direct.status).toBe(StatusCodes.FORBIDDEN);
    expect(await direct.json()).toMatchObject({ error: 'origin_forbidden' });
    expect((await app.request('/api/status', { headers: { 'x-origin-verify': 'guess' } })).status).toBe(
      StatusCodes.FORBIDDEN,
    );
    const viaCloudFront = await app.request('/api/status', { headers: { 'x-origin-verify': 'from-cloudfront' } });
    expect(viaCloudFront.status).toBe(StatusCodes.OK);
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
    const session = res.headers['set-cookie']!.split(/,\s*(?=pm_)/).find((c) => c.startsWith('pm_session='))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/Secure/i);
    expect(session).toMatch(/SameSite=Strict/i);
  });

  it('binds the owner on first login and rejects other accounts', async () => {
    const t = setup();
    const res = await login(t);
    expect(res.status).toBe(302);
    expect(res.headers.Location).toBe('/?welcome=1');
    expect(t.syncs).toHaveLength(1);
    expect((await t.store.getConfig())!.ownerId).toBe('owner');
    expect((await t.call('GET', '/api/today')).status).toBe(200);

    t.clearCookies();
    t.setUser('intruder');
    const bad = await login(t);
    expect(bad.headers.Location).toBe('/login?error=wrong_account');
    expect((await t.call('GET', '/api/today')).status).toBe(401);
  });

  it('lets only one of two accounts logging in at the same time become the owner', async () => {
    const t = setup();
    // Both logins read the config before either has written it.
    const getConfig = t.store.getConfig.bind(t.store);
    t.store.getConfig = async () => undefined;
    expect((await login(t)).headers.Location).toBe('/?welcome=1');
    t.clearCookies();
    t.setUser('intruder');
    expect((await login(t)).headers.Location).toBe('/login?error=wrong_account');
    t.store.getConfig = getConfig;
    expect((await t.store.getConfig())?.ownerId).toBe('owner');
    expect((await t.call('GET', '/api/today')).status).toBe(401);
  });

  it('rejects a callback with a wrong state', async () => {
    const t = setup();
    await t.call('GET', '/api/auth/login');
    const res = await t.call('GET', '/api/auth/callback?code=x&state=forged');
    expect(res.headers.Location).toBe('/login?error=state_mismatch');
  });

  it('rejects a callback without the state cookie', async () => {
    const t = setup();
    const start = await t.call('GET', '/api/auth/login');
    const state = new URL(start.headers.Location!).searchParams.get('state');
    // e.g. the login took longer than the cookie lives, or started in another browser
    t.clearCookies();
    const res = await t.call('GET', `/api/auth/callback?code=x&state=${state}`);
    expect(res.headers.Location).toBe('/login?error=state_mismatch');
    expect(await t.store.getTokens()).toBeUndefined();
  });

  it("passes Spotify's own OAuth error on to the login page", async () => {
    const t = setup();
    const start = await t.call('GET', '/api/auth/login');
    const state = new URL(start.headers.Location!).searchParams.get('state');
    const res = await t.call('GET', `/api/auth/callback?error=access_denied&state=${state}`);
    expect(res.headers.Location).toBe('/login?error=access_denied');
    expect(await t.store.getConfig()).toBeUndefined();
  });

  it('rejects a callback without an authorization code', async () => {
    const t = setup();
    const start = await t.call('GET', '/api/auth/login');
    const state = new URL(start.headers.Location!).searchParams.get('state');
    const res = await t.call('GET', `/api/auth/callback?state=${state}`);
    expect(res.headers.Location).toBe('/login?error=token_exchange_failed');
    expect(await t.store.getTokens()).toBeUndefined();
  });

  it('sends the user back to the login page when the login cannot be stored', async () => {
    const t = setup();
    t.store.putTokens = async () => {
      throw new Error('table unavailable');
    };
    const res = await login(t);
    expect(res.status).toBe(302);
    expect(res.headers.Location).toBe('/login?error=login_failed');
  });

  describe('with the Spotify accounts service', () => {
    afterEach(() => vi.restoreAllMocks());

    const tokenResponse = (accessToken: string, refreshToken?: string) =>
      Response.json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'user-library-read',
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
      });

    /**
     * Answers the requests of the real OAuth login: `token` the code exchange
     * at the accounts service, `me` the lookup of the Spotify user.
     */
    function spotifyAnswers(token: () => Response, me: () => Response) {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = input instanceof Request ? input.url : String(input);
        return url.startsWith('https://accounts.spotify.com/') ? token() : me();
      });
    }

    it('explains that a Spotify account is missing from the user list of the Spotify app', async () => {
      const t = setup({ auth: spotifyAuth });
      spotifyAnswers(
        () => tokenResponse('a1', 'r1'),
        () => new Response(null, { status: 403 }),
      );
      expect((await login(t)).headers.Location).toBe('/login?error=spotify_user_not_allowed');
      expect(await t.store.getConfig()).toBeUndefined();
      expect(await t.store.getTokens()).toBeUndefined();
    });

    it('explains that Spotify rejects the client credentials', async () => {
      const t = setup({ auth: spotifyAuth });
      const fetchSpy = spotifyAnswers(
        () => Response.json({ error: 'invalid_client', error_description: 'Invalid client secret' }, { status: 400 }),
        () => Response.json({ id: 'owner' }),
      );
      expect((await login(t)).headers.Location).toBe('/login?error=spotify_invalid_client');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(await t.store.getTokens()).toBeUndefined();
    });

    it('keeps the stored refresh token when Spotify sends none on a new login', async () => {
      const t = setup({ auth: spotifyAuth });
      let token = () => tokenResponse('a1', 'r1');
      spotifyAnswers(
        () => token(),
        () => Response.json({ id: 'owner', display_name: 'Owner' }),
      );
      await login(t);
      token = () => tokenResponse('a2');
      t.clearCookies();
      await login(t);
      expect(await t.store.getTokens()).toMatchObject({ accessToken: 'a2', refreshToken: 'r1' });
    });

    it('ends the revoked state when the owner logs in again', async () => {
      const t = setup({ auth: spotifyAuth });
      let token = () => tokenResponse('a1', 'r1');
      spotifyAnswers(
        () => token(),
        () => Response.json({ id: 'owner', display_name: 'Owner' }),
      );
      await login(t);
      const { createdAt } = (await t.store.getConfig())!;
      // what the client does when Spotify rejects the refresh token
      await t.store.deleteTokens('r1');
      await t.store.markDisconnected('2026-01-01T00:00:00.000Z');

      token = () => tokenResponse('a2', 'r2');
      t.clearCookies();
      await login(t);
      const config = (await t.store.getConfig())!;
      expect(config.disconnectedAt).toBeUndefined();
      expect(config).toMatchObject({ ownerId: 'owner', ownerName: 'Owner', createdAt });
      expect(await t.store.getTokens()).toMatchObject({ accessToken: 'a2', refreshToken: 'r2' });
      const status = (await t.call('GET', '/api/status')).body as AppStatus;
      expect(status).toMatchObject({ authenticated: true, spotifyConnected: true });
      expect(status.disconnectedAt).toBeUndefined();
    });

    it("leaves the owner's tokens untouched when another account logs in", async () => {
      const t = setup({ auth: spotifyAuth });
      let token = () => tokenResponse('owner-access', 'owner-refresh');
      let userId = 'owner';
      spotifyAnswers(
        () => token(),
        () => Response.json({ id: userId }),
      );
      await login(t);
      const stored = await t.store.getTokens();

      token = () => tokenResponse('intruder-access', 'intruder-refresh');
      userId = 'intruder';
      t.clearCookies();
      expect((await login(t)).headers.Location).toBe('/login?error=wrong_account');
      expect(await t.store.getTokens()).toEqual(stored);
      expect((await t.store.getConfig())?.ownerId).toBe('owner');
    });
  });

  it('frees the lease when the sync cannot be started, without failing the login', async () => {
    const t = setup({ triggerFails: true });
    const res = await login(t); // first login tries to start the initial import
    expect(res.headers.Location).toBe('/?welcome=1');
    const state = await t.store.getSyncState();
    expect(state.status).toBe('error');
    expect(state.errorCode).toBe('sync_start_failed');
    expect(state.leaseId).toBeUndefined();
    // the button reports the failure, and nothing stays blocked
    const retry = await t.call('POST', '/api/sync', {});
    expect(retry.status).toBe(502);
    expect(retry.body).toMatchObject({ error: 'sync_start_failed' });
    expect((await t.store.getSyncState()).leaseId).toBeUndefined();
  });

  it('never runs two syncs at once', async () => {
    const t = setup();
    await login(t); // the first login starts the initial import
    expect(t.syncs).toHaveLength(1);
    const lease = t.syncs[0]!.leaseId;
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
    expect(done).toMatchObject({ status: 'idle', showsSynced: 5, showsFailed: 0 });
    expect((await t.store.getSyncState()).leaseId).toBeUndefined();
    expect(await t.store.listShows()).toHaveLength(5);

    // Afterwards a new sync can start.
    await t.call('POST', '/api/sync', {});
    expect(t.syncs).toHaveLength(2);
  });

  it('reports a sync that stopped without finishing as interrupted, and lets a new one start', async () => {
    const t = setup();
    await login(t);
    await t.sync();
    // a sync Lambda that crashed leaves its lease behind
    await acquireSyncLease(t.store, { message: 'läuft' }, undefined, new Date(Date.now() - STALE_SYNC_MS - 1000));
    const status = (await t.call('GET', '/api/status')).body as AppStatus;
    expect(status.sync).toMatchObject({ status: 'error', errorCode: 'sync_interrupted' });
    expect((await t.call('POST', '/api/sync', {})).body).toMatchObject({ status: 'running' });
    expect(t.syncs).toHaveLength(2);
  });

  it('reports which podcast a single reload is for, and why a sync failed', async () => {
    const t = setup();
    await login(t);
    await t.sync();
    const running = await t.call('POST', '/api/shows/demo-dertag/sync', {});
    expect(running.body).toMatchObject({ status: 'running', showId: 'demo-dertag' });
    const reloaded = await t.sync();
    expect(reloaded.status).toBe('idle');
    expect(reloaded.showId).toBeUndefined();

    t.spotify.getSavedShows = async () => {
      throw new ApiError(StatusCodes.TOO_MANY_REQUESTS, 'spotify_rate_limited', 'Rate-Limit', { minutes: 3 });
    };
    await t.call('POST', '/api/sync', {});
    expect(await t.sync()).toMatchObject({
      status: 'error',
      errorCode: 'spotify_rate_limited',
      errorParams: { minutes: 3 },
    });
  });

  it('requires JSON for mutating requests', async () => {
    const t = setup();
    const res = await t.call('POST', '/api/auth/logout', undefined, { 'content-type': 'text/plain' });
    expect(res.status).toBe(415);
  });

  it('accepts only the JSON media type itself, not a simple type that mentions it', async () => {
    const t = setup();
    // Browsers send text/plain with any parameters without a CORS preflight.
    const sneaky = await t.call('POST', '/api/auth/logout', undefined, {
      'content-type': 'text/plain;x=application/json',
    });
    expect(sneaky.status).toBe(415);
    const json = await t.call('POST', '/api/auth/logout', undefined, {
      'content-type': 'Application/JSON; charset=utf-8',
    });
    expect(json.status).not.toBe(415);
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

  it('reloads a podcast when its sync window changes, and keeps the window within bounds', async () => {
    const t = await ready();
    const patch = (body: unknown) => t.call('PATCH', '/api/shows/demo-dertag', body);
    const reloads = () => t.syncs.filter((s) => s.showId === 'demo-dertag').length;

    expect(((await patch({ syncWindowDays: 30 })).body as Show).syncWindowDays).toBe(30);
    expect(reloads()).toBe(1);
    await t.sync(); // the reload runs and frees the lease
    await patch({ syncWindowDays: 30, paused: false });
    expect(reloads()).toBe(1); // unchanged window: no reload

    expect(((await patch({ syncWindowDays: 99_999 })).body as Show).syncWindowDays).toBe(3650);
    await t.sync();
    expect(((await patch({ syncWindowDays: 0 })).body as Show).syncWindowDays).toBeNull();
    expect(reloads()).toBe(3);

    const settings = await t.call('PUT', '/api/settings', { newShowSyncWindowDays: -5 });
    expect(settings.body).toMatchObject({ newShowSyncWindowDays: 0 });
  });

  it('rejects request fields of the wrong type instead of storing them', async () => {
    const t = await ready();
    const path = '/api/shows/demo-dertag';
    const invalid = async (body: unknown, field: string) => {
      const res = await t.call('PATCH', path, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body).toMatchObject({ error: 'invalid_field', params: { field } });
    };
    await invalid('{"priority":1e400}', 'priority');
    await invalid({ pinnedEpisodeId: { id: 'x' } }, 'pinnedEpisodeId');
    await invalid({ paused: 'yes' }, 'paused');
    await invalid({ categories: 'Politik' }, 'categories');
    const show = (await t.call('GET', path)).body as ShowDetailResponse;
    expect(show.show).toMatchObject({ paused: false, pinnedEpisodeId: null });

    expect((await t.call('POST', '/api/shows/reorder', ['demo-dertag'])).body).toMatchObject({ error: 'invalid_body' });
    const play = await t.call('POST', '/api/player/play', {
      showId: 'demo-dertag',
      episodeId: 'demo-dertag-1',
      positionMs: '100',
    });
    expect(play.body).toMatchObject({ error: 'invalid_field', params: { field: 'positionMs' } });
  });

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
    expect(items[0]!.show.mode).toBe('LATEST');
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
    await t.call('PATCH', `/api/shows/${id}`, {
      pinnedEpisodeId: `${id}-20`,
      mode: 'MANUAL',
      categories: ['Geographie'],
    });
    await t.sync(true);
    const show = (await t.call('GET', `/api/shows/${id}`)).body as ShowDetailResponse;
    expect(show.show.mode).toBe('MANUAL');
    expect(show.show.categories).toEqual(['Geographie']);
    expect(show.show.summary!.nextEpisode!.id).toBe(`${id}-20`);
    expect(show.show.summary!.completed).toBe(8);

    const history = (await t.call('GET', '/api/history')).body as unknown[];
    expect(history).toHaveLength(8);
  });

  it('keeps a setting when its new value is invalid', async () => {
    const t = await ready();
    await t.call('PUT', '/api/settings', { budgetTolerancePercent: 25, autoCompleteInPlayer: false });
    const saved = await t.call('PUT', '/api/settings', {
      budgetTolerancePercent: 'viel',
      autoCompleteInPlayer: 'false',
      audioBudgetMinutes: 1000,
    });
    expect(saved.body).toMatchObject({
      budgetTolerancePercent: 25,
      autoCompleteInPlayer: false,
      audioBudgetMinutes: 600,
    });
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

  it("plans the week and puts today's slots on top of Heute", async () => {
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
    expect(week.days[0]!.isToday).toBe(true);
    expect(week.days[0]!.items.map((i) => [i.show.id, i.state])).toEqual([
      ['demo-dertag', 'next'],
      ['demo-wissensreise', 'next'],
    ]);
    expect(week.days[1]!.items[0]!.episode?.id).toBe('demo-wissensreise-2');

    let today = (await t.call('GET', `/api/today?tz=${tz}`)).body as TodayResponse;
    expect(today.plan.map((p) => p.show.id)).toEqual(['demo-dertag', 'demo-wissensreise']);
    expect([...today.recommended, ...today.more].some((i) => i.show.id === 'demo-dertag')).toBe(false);

    // Finishing the planned episode ticks the slot off instead of advancing it.
    await t.call('PUT', '/api/shows/demo-wissensreise/episodes/demo-wissensreise-1/status', { status: 'COMPLETED' });
    today = (await t.call('GET', `/api/today?tz=${tz}`)).body as TodayResponse;
    const slot = today.plan.find((p) => p.show.id === 'demo-wissensreise')!;
    expect([slot.state, slot.episode?.id]).toEqual(['done', 'demo-wissensreise-1']);
    const nextWeek = (await t.call('GET', `/api/week?tz=${tz}`)).body as WeekResponse;
    expect(nextWeek.days[1]!.items[0]!.episode?.id).toBe('demo-wissensreise-2');
  });

  it('ticks off a planned slot for an episode finished in the Spotify app', async () => {
    const t = await ready();
    const tz = 'Europe/Berlin';
    const weekday = weekdayOf(localDate(Date.now(), tz));
    await t.call('PUT', '/api/schedule', {
      rules: [
        { showId: 'demo-wissensreise', weekdays: [weekday], part: 'MORNING' },
        { showId: 'demo-seinundstreit', weekdays: [weekday], part: 'EVENING' },
      ],
    });
    const path = '/api/shows/demo-wissensreise/episodes/demo-wissensreise-1';
    await t.call('POST', '/api/player/play', {
      showId: 'demo-wissensreise',
      episodeId: 'demo-wissensreise-1',
      deviceId: 'demo-phone',
      fromStart: true,
    });
    const { durationMs } = (await t.call('GET', path)).body as EpisodeView;
    t.spotify.controlPlayback('pause');
    t.spotify.controlPlayback('seek', durationMs);
    await t.call('POST', `${path}/refresh`);

    const today = (await t.call('GET', `/api/today?tz=${tz}`)).body as TodayResponse;
    expect(today.plan.map((p) => [p.show.id, p.state, p.episode?.id])).toEqual([
      ['demo-wissensreise', 'done', 'demo-wissensreise-1'],
      // Finished in Spotify before the first import: not heard today.
      ['demo-seinundstreit', 'next', 'demo-seinundstreit-3'],
    ]);
  });

  it('validates plan rules', async () => {
    const t = await ready();
    const save = (body: unknown) => t.call('PUT', '/api/schedule', body);
    expect((await save({ rules: [{ weekdays: [1] }] })).body).toMatchObject({ error: 'rule_show_missing' });
    expect(
      (await save({ rules: Array.from({ length: 201 }, () => ({ showId: 'demo-dertag', weekdays: [1] })) })).body,
    ).toEqual({
      error: 'too_many_rules',
      message: 'Höchstens 200 Regeln',
      params: { max: 200 },
    });
    expect((await save({ rules: [{ showId: 'demo-dertag', weekdays: [] }] })).status).toBe(400);
    expect((await save({ rules: [{ showId: 'demo-dertag', weekdays: [8] }] })).status).toBe(400);
    expect((await save({ rules: 'x' })).status).toBe(400);
    expect((await save({ rules: [null] })).status).toBe(400);

    const res = await save({
      rules: [
        { id: 'same', showId: 'demo-dertag', weekdays: [5, 1, 1], part: 'NIGHT' },
        { id: 'same', showId: 'demo-wissensreise', weekdays: [2], part: 'EVENING' },
      ],
    });
    expect(res.status).toBe(200);
    const [first, second] = (res.body as Schedule).rules;
    expect(first).toEqual({ id: 'same', showId: 'demo-dertag', weekdays: [1, 5], part: 'ANYTIME' });
    expect(second!.id).not.toBe('same');
  });

  it('does not overwrite a plan that changed since it was loaded', async () => {
    const t = await ready();
    const rules = [{ id: 'a', showId: 'demo-dertag', weekdays: [1], part: 'MORNING' }];
    // The first save is based on "no plan stored yet".
    const first = await t.call('PUT', '/api/schedule', { rules, expectedUpdatedAt: null });
    expect(first.status).toBe(200);
    const version = (first.body as Schedule).updatedAt;

    // A second tab that still believes there is no plan is rejected.
    const stale = await t.call('PUT', '/api/schedule', { rules: [], expectedUpdatedAt: null });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: 'schedule_conflict' });
    expect(((await t.call('GET', '/api/schedule')).body as Schedule).rules).toHaveLength(1);

    // A save based on the current version goes through.
    const next = await t.call('PUT', '/api/schedule', { rules: [], expectedUpdatedAt: version });
    expect(next.status).toBe(200);
    expect((await t.call('PUT', '/api/schedule', { rules, expectedUpdatedAt: version })).status).toBe(409);

    // Without expectedUpdatedAt the plan is overwritten.
    expect((await t.call('PUT', '/api/schedule', { rules })).status).toBe(200);
  });

  it('exports the plan as rules', async () => {
    const t = await ready();
    const rules = [{ id: 'a', showId: 'demo-dertag', weekdays: [1, 3], part: 'MORNING' }];
    expect((await t.call('PUT', '/api/schedule', { rules })).status).toBe(200);
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

  it('keeps any number of notes per episode, each with its own position', async () => {
    const t = await ready();
    const path = '/api/shows/demo-wissensreise/episodes/demo-wissensreise-1/notes';
    expect((await t.call('GET', path)).body).toEqual([]);

    const later = await t.call('POST', path, { text: 'Spannender Punkt', positionMs: 130_400.6 });
    expect(later.status).toBe(StatusCodes.CREATED);
    expect(later.body).toMatchObject({
      id: expect.any(String),
      positionMs: 130_401,
      text: 'Spannender Punkt',
      showName: 'Wissensreise',
      episodeReleaseDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}/),
    });
    await t.call('POST', path, { text: 'Zur ganzen Folge', positionMs: null });
    await t.call('POST', path, { text: 'Am Anfang', positionMs: 5_000 });
    expect(((await t.call('GET', path)).body as EpisodeNote[]).map((n) => n.positionMs)).toEqual([
      null,
      5_000,
      130_401,
    ]);

    const detail = (await t.call('GET', '/api/shows/demo-wissensreise')).body as ShowDetailResponse;
    expect(detail.episodes.find((e) => e.id === 'demo-wissensreise-1')!.hasNote).toBe(true);
    expect(detail.episodes.find((e) => e.id === 'demo-wissensreise-2')!.hasNote).toBe(false);
    expect(((await t.call('GET', '/api/notes')).body as EpisodeNote[]).map((n) => n.text)).toEqual([
      'Am Anfang',
      'Zur ganzen Folge',
      'Spannender Punkt',
    ]);
  });

  it('edits and deletes a single note', async () => {
    const t = await ready();
    const path = '/api/shows/demo-wissensreise/episodes/demo-wissensreise-1/notes';
    const { id, createdAt } = (await t.call('POST', path, { text: 'Erst', positionMs: 1_000 })).body as EpisodeNote;
    await t.call('POST', path, { text: 'Bleibt', positionMs: 2_000 });

    const edited = await t.call('PATCH', `${path}/${id}`, { text: 'Korrigiert' });
    expect(edited.body).toMatchObject({ id, text: 'Korrigiert', positionMs: 1_000, createdAt });
    expect((await t.call('PATCH', `${path}/${id}`, { positionMs: null })).body).toMatchObject({ positionMs: null });
    expect((await t.call('PATCH', `${path}/${id}`, { text: ' ' })).body).toMatchObject({ error: 'invalid_note' });

    expect((await t.call('DELETE', `${path}/${id}`)).status).toBe(200);
    expect(((await t.call('GET', path)).body as EpisodeNote[]).map((n) => n.text)).toEqual(['Bleibt']);
    expect((await t.call('PATCH', `${path}/${id}`, { text: 'x' })).body).toMatchObject({ error: 'note_not_found' });
  });

  it('rejects notes without text, with an invalid position or for an unknown episode', async () => {
    const t = await ready();
    const path = '/api/shows/demo-wissensreise/episodes/demo-wissensreise-1/notes';
    expect((await t.call('POST', path, { text: '  ' })).body).toMatchObject({ error: 'invalid_note' });
    expect((await t.call('POST', path, { text: 'x', positionMs: -1 })).body).toMatchObject({
      error: 'invalid_note_position',
    });
    expect((await t.call('POST', path, { text: 'x', positionMs: '1:00' })).body).toMatchObject({
      error: 'invalid_note_position',
    });
    expect((await t.call('POST', '/api/shows/demo-wissensreise/episodes/nope/notes', { text: 'x' })).status).toBe(404);
  });

  it('gives a new note the position Spotify is playing the episode at', async () => {
    const t = await ready();
    const path = '/api/shows/demo-wissensreise/episodes/demo-wissensreise-1/notes';
    const playing = vi.spyOn(t.spotify, 'getPlayingEpisode');

    playing.mockResolvedValue({
      episodeId: 'demo-wissensreise-1',
      positionMs: 754_000,
      durationMs: 1_800_000,
      paused: false,
    });
    expect((await t.call('POST', path, { text: 'Am Handy notiert' })).body).toMatchObject({ positionMs: 754_000 });
    // An explicit position (or null) wins over the playback state.
    expect((await t.call('POST', path, { text: 'x', positionMs: 1_000 })).body).toMatchObject({ positionMs: 1_000 });
    expect((await t.call('POST', path, { text: 'x', positionMs: null })).body).toMatchObject({ positionMs: null });

    playing.mockResolvedValue({
      episodeId: 'demo-wissensreise-2',
      positionMs: 754_000,
      durationMs: 1_800_000,
      paused: false,
    });
    expect((await t.call('POST', path, { text: 'Andere Folge läuft' })).body).toMatchObject({ positionMs: null });

    playing.mockRejectedValue(new ApiError(StatusCodes.FORBIDDEN, 'spotify_forbidden', 'no', { detail: 'no' }));
    const saved = await t.call('POST', path, { text: 'Spotify nicht erreichbar' });
    expect(saved.status).toBe(StatusCodes.CREATED);
    expect(saved.body).toMatchObject({ positionMs: null });
  });

  it('reports a listed device that Spotify cannot reach', async () => {
    const t = await ready();
    const devices = (await t.call('GET', '/api/player/devices')).body as { id: string; name: string }[];
    const sleeping = devices.find((d) => d.name.includes('Standby'))!;
    const res = await t.call('POST', '/api/player/play', {
      showId: 'demo-wissensreise',
      episodeId: 'demo-wissensreise-1',
      deviceId: sleeping.id,
    });
    expect(res.status).toBe(StatusCodes.NOT_FOUND);
    expect(res.body).toMatchObject({ error: 'device_unavailable' });
    const ok = await t.call('POST', '/api/player/play', {
      showId: 'demo-wissensreise',
      episodeId: 'demo-wissensreise-1',
      deviceId: 'demo-phone',
    });
    expect(ok.status).toBe(200);
  });

  it('reports what Spotify plays on any device', async () => {
    const t = await ready();
    expect((await t.call('GET', '/api/player/state')).body).toBeNull();
    await t.call('POST', '/api/player/play', {
      showId: 'demo-wissensreise',
      episodeId: 'demo-wissensreise-1',
      deviceId: 'demo-phone',
      fromStart: true,
    });
    expect((await t.call('GET', '/api/player/state')).body).toMatchObject({
      episodeId: 'demo-wissensreise-1',
      paused: false,
      deviceName: 'Handy (Demo)',
    });
  });

  it('refreshes an episode from Spotify, e.g. after listening in the Spotify app', async () => {
    const t = await ready();
    const path = '/api/shows/demo-wissensreise/episodes/demo-wissensreise-1';
    await t.call('POST', '/api/player/play', {
      showId: 'demo-wissensreise',
      episodeId: 'demo-wissensreise-1',
      deviceId: 'demo-phone',
      fromStart: true,
    });
    const { durationMs } = (await t.call('GET', path)).body as EpisodeView;

    t.spotify.controlPlayback('pause');
    t.spotify.controlPlayback('seek', durationMs / 2);
    const halfway = (await t.call('POST', `${path}/refresh`)).body as EpisodeView;
    expect(halfway).toMatchObject({ status: 'IN_PROGRESS', statusSource: 'spotify' });
    expect(halfway.remainingMs).toBeCloseTo(durationMs / 2, -3);

    t.spotify.controlPlayback('seek', durationMs);
    expect((await t.call('POST', `${path}/refresh`)).body).toMatchObject({
      status: 'COMPLETED',
      statusSource: 'spotify',
    });
    // The show's summary follows: the finished episode is no longer the next one.
    const shows = (await t.call('GET', '/api/shows')).body as Show[];
    expect(shows.find((s) => s.id === 'demo-wissensreise')!.summary?.nextEpisode?.id).not.toBe('demo-wissensreise-1');

    expect((await t.call('POST', '/api/shows/demo-wissensreise/episodes/nope/refresh')).status).toBe(404);
  });

  it('updates the show when playing an episode Spotify reports as finished', async () => {
    const t = await ready();
    const play = { showId: 'demo-wissensreise', episodeId: 'demo-wissensreise-1', deviceId: 'demo-phone' };
    const next = async () =>
      ((await t.call('GET', '/api/shows')).body as Show[]).find((s) => s.id === 'demo-wissensreise')!.summary
        ?.nextEpisode?.id;
    await t.call('POST', '/api/player/play', { ...play, fromStart: true });
    expect(await next()).toBe('demo-wissensreise-1');

    // finished in the Spotify app; playing it here again picks that up
    const { durationMs } = (await t.call('GET', '/api/shows/demo-wissensreise/episodes/demo-wissensreise-1'))
      .body as EpisodeView;
    t.spotify.controlPlayback('seek', durationMs);
    expect((await t.call('POST', '/api/player/play', play)).body).toMatchObject({ positionMs: 0 });
    expect(await next()).not.toBe('demo-wissensreise-1');
  });

  it('deletes all data', async () => {
    const t = await ready();
    expect((await t.call('DELETE', '/api/data')).status).toBe(200);
    expect(await t.store.listShows()).toHaveLength(0);
    expect(await t.store.getConfig()).toBeUndefined();
  });

  it('refuses to delete all data while a sync runs, which could write it back', async () => {
    const t = await ready();
    await t.call('POST', '/api/sync', { full: true });
    const refused = await t.call('DELETE', '/api/data');
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: 'sync_running' });
    expect(await t.store.listShows()).toHaveLength(5);

    await t.sync(); // the running sync finishes
    expect((await t.call('DELETE', '/api/data')).status).toBe(200);
    expect(await t.store.listShows()).toHaveLength(0);
  });
});

describe('Up next playlist', () => {
  const tz = 'Europe/Berlin';

  async function ready(on = true) {
    const t = setup();
    await login(t);
    expect((await t.sync()).status).toBe('idle');
    if (on) await t.call('PUT', '/api/settings', { playThroughPlaylist: true });
    return t;
  }
  /** The content of the one playlist the app created. */
  const listed = (t: ReturnType<typeof setup>) => [...t.spotify.playlists.values()][0] ?? [];
  const todayItems = async (t: ReturnType<typeof setup>) => {
    const today = (await t.call('GET', `/api/today?tz=${tz}`)).body as TodayResponse;
    return [...today.recommended, ...today.more].map((i) => ({ showId: i.show.id, episodeId: i.episode.id }));
  };
  /** Lets the fake playback run past the end of the playing episode. */
  const playToEnd = async (t: ReturnType<typeof setup>) => {
    t.spotify.controlPlayback('seek', t.spotify.playbackState().durationMs - 1);
    await new Promise((r) => setTimeout(r, 30));
  };

  it('mirrors Today in a playlist and continues with its next episode instead of Autoplay', async () => {
    const t = await ready();
    const items = await todayItems(t);
    expect(t.spotify.playlists.size).toBe(1);
    expect(listed(t)).toEqual(items.map((i) => i.episodeId));

    const chosen = items[1]!;
    const play = await t.call('POST', '/api/player/play', { ...chosen, deviceId: 'demo-phone', tz });
    expect(play.status).toBe(200);
    expect(listed(t)[0]).toBe(chosen.episodeId);

    await playToEnd(t);
    const next = listed(t)[1]!;
    expect(t.spotify.playbackState().episodeId).toBe(next);
    const state = (await t.call('GET', '/api/player/state')).body;
    const expected = items.find((i) => i.episodeId === next)!;
    expect(state).toMatchObject({ episodeId: next, inUpNext: true, upNextEpisode: { showId: expected.showId } });
  });

  it("reports Spotify's Autoplay after the last item, and pauses it on request", async () => {
    const t = await ready();
    // With all podcasts but one paused, Today and the playlist hold a single episode.
    const [kept, ...others] = await t.store.listShows();
    for (const show of others) await t.call('PATCH', `/api/shows/${show.id}`, { paused: true });
    const items = await todayItems(t);
    expect(items.map((i) => i.showId)).toEqual([kept!.id]);
    await t.call('POST', '/api/player/play', { ...items[0], deviceId: 'demo-phone', tz });
    expect(listed(t)).toEqual([items[0]!.episodeId]);
    await playToEnd(t);

    const state = (await t.call('GET', '/api/player/state')).body as PlaybackState;
    expect(listed(t)).not.toContain(state.episodeId);
    expect(state).toMatchObject({ inUpNext: false, paused: false });
    expect((await t.call('POST', '/api/player/pause')).status).toBe(200);
    expect(t.spotify.playbackState().paused).toBe(true);
  });

  it('drops heard episodes, refreshes after a sync and recreates a playlist deleted in Spotify', async () => {
    const t = await ready();
    expect(t.spotify.playlists.size).toBe(0); // nothing written before Today, a play or a sync
    await t.sync();
    expect(t.spotify.playlists.size).toBe(1);

    const [first] = await todayItems(t);
    await t.call('PUT', `/api/shows/${first!.showId}/episodes/${first!.episodeId}/status`, { status: 'COMPLETED' });
    expect(listed(t)).not.toContain(first!.episodeId);

    t.spotify.playlists.clear();
    const [next] = await todayItems(t);
    await t.call('POST', '/api/player/play', { ...next, deviceId: 'demo-phone', tz });
    expect(t.spotify.playlists.size).toBe(1);
    expect(listed(t)[0]).toBe(next!.episodeId);
  });

  it('plays single episodes while switched off, and when the playlist cannot be written', async () => {
    const off = await ready(false);
    const [item] = await todayItems(off);
    await off.call('POST', '/api/player/play', { ...item, deviceId: 'demo-phone', tz });
    expect(off.spotify.playlists.size).toBe(0);
    expect((await off.call('GET', '/api/player/state')).body).not.toHaveProperty('inUpNext');

    const denied = await ready();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(denied.spotify, 'createPlaylist').mockRejectedValue(
      new ApiError(StatusCodes.FORBIDDEN, 'spotify_forbidden', 'Insufficient client scope', { detail: 'scope' }),
    );
    const [other] = await todayItems(denied);
    const play = await denied.call('POST', '/api/player/play', { ...other, deviceId: 'demo-phone', tz });
    expect(play.status).toBe(200);
    expect(denied.spotify.playbackState().episodeId).toBe(other!.episodeId);
  });

  it('asks for the playlist permission only while Up next is switched on', async () => {
    const t = await ready(false);
    const scopes = async () => ((await t.call('GET', '/api/status')).body as AppStatus).missingScopes;
    expect(await scopes()).not.toContain('playlist-modify-private');
    await t.call('PUT', '/api/settings', { playThroughPlaylist: true });
    expect(await scopes()).toContain('playlist-modify-private');
  });
});
