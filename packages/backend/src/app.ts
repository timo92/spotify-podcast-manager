import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  buildToday,
  DEFAULT_SETTINGS,
  type AppStatus,
  type EpisodeStatus,
  type HistoryItem,
  type PlayerDevice,
  type Settings,
  type ShowSettingsPatch,
} from '@podcast/shared';
import { ApiError, badRequest, notFound, unauthorized } from './errors.js';
import { json, redirect, serializeCookie, type HttpRequest, type HttpResponse } from './http/types.js';
import { LibraryService } from './services/library.js';
import { PlanService, validTimeZone } from './services/plan.js';
import { isSyncRunning, toEpisode, type SyncOptions } from './services/sync.js';
import { authorizeUrl, exchangeCode, SCOPES } from './spotify/client.js';
import type { SpotifyApi, SpotifyUser } from './spotify/types.js';
import type { SpotifyTokens, Store } from './store/types.js';

export interface AppDeps {
  store: Store;
  spotify: SpotifyApi;
  /** Starts a sync in the background (async Lambda invocation / in-process locally). */
  triggerSync: (opts: SyncOptions) => Promise<void>;
  /** Required to claim the app the first time. */
  setupCode?: string;
  /** Public base URL, e.g. https://podcasts.example.com. Derived from headers if unset. */
  publicUrl?: string;
  /** Offline demo mode with fake Spotify data. */
  demo?: boolean;
  /** Override for tests: exchanges an OAuth code and returns tokens + user. */
  oauth?: (code: string, redirectUri: string) => Promise<{ tokens: SpotifyTokens; user: SpotifyUser }>;
}

const SESSION_COOKIE = 'pm_session';
const STATE_COOKIE = 'pm_oauth_state';
const SESSION_DAYS = 90;

type Handler = (req: HttpRequest, params: Record<string, string>) => Promise<HttpResponse>;
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  public?: boolean;
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = path.replace(/:(\w+)/g, (_, k: string) => {
    keys.push(k);
    return '([^/]+)';
  });
  return { pattern: new RegExp(`^${src}/?$`), keys };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function body<T>(req: HttpRequest): Partial<T> {
  return req.body && typeof req.body === 'object' ? (req.body as Partial<T>) : {};
}

export function createApp(deps: AppDeps) {
  const { store, spotify } = deps;
  const library = new LibraryService(store);
  const planner = new PlanService(store, library);
  const routes: Route[] = [];
  const route = (method: string, path: string, handler: Handler, opts: { public?: boolean } = {}) =>
    routes.push({ method, ...compile(path), handler, public: opts.public });

  const baseUrl = (req: HttpRequest) => {
    if (deps.publicUrl) return deps.publicUrl.replace(/\/$/, '');
    const host = req.headers['x-public-host'] ?? req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    const proto = local ? 'http' : 'https';
    return `${proto}://${host}`;
  };
  const redirectUri = (req: HttpRequest) => `${baseUrl(req)}/api/auth/callback`;
  const secure = (req: HttpRequest) => baseUrl(req).startsWith('https://');

  async function isAuthenticated(req: HttpRequest): Promise<boolean> {
    const id = req.cookies[SESSION_COOKIE];
    if (!id) return false;
    return !!(await store.getSession(id));
  }

  async function startSync(opts: SyncOptions) {
    const state = await store.getSyncState();
    if (isSyncRunning(state)) return state;
    const next = { ...state, status: 'running' as const, startedAt: new Date().toISOString(), message: 'Gestartet…' };
    await store.putSyncState(next);
    await deps.triggerSync(opts);
    return next;
  }

  // ---------------------------------------------------------------- status

  route(
    'GET',
    '/api/status',
    async (req) => {
      const [config, authenticated] = await Promise.all([store.getConfig(), isAuthenticated(req)]);
      const status: AppStatus & { demo?: boolean } = {
        configured: !!config,
        authenticated,
        redirectUri: redirectUri(req),
        setupCodeRequired: !!deps.setupCode && !config?.ownerId,
        claimed: !!config?.ownerId,
        demo: deps.demo,
      };
      if (authenticated) {
        const [tokens, sync] = await Promise.all([store.getTokens(), store.getSyncState()]);
        const granted = (tokens?.scope ?? '').split(' ').filter(Boolean);
        status.spotifyConnected = !!tokens;
        status.user = config?.ownerId ? { id: config.ownerId, displayName: config.ownerName } : undefined;
        status.sync = sync;
        status.grantedScopes = granted;
        status.missingScopes = tokens && !deps.demo ? SCOPES.filter((s) => !granted.includes(s)) : [];
      }
      return json(status);
    },
    { public: true },
  );

  // ----------------------------------------------------------------- setup

  route(
    'POST',
    '/api/setup',
    async (req) => {
      const input = body<{ setupCode: string; clientId: string; clientSecret: string }>(req);
      const [config, authenticated] = await Promise.all([store.getConfig(), isAuthenticated(req)]);
      if (config?.ownerId && !authenticated) {
        throw new ApiError(403, 'already_configured', 'Die App ist bereits eingerichtet. Bitte anmelden.');
      }
      if (!authenticated && deps.setupCode && !safeEqual(String(input.setupCode ?? '').trim(), deps.setupCode)) {
        throw new ApiError(403, 'invalid_setup_code', 'Der Setup-Code ist falsch (siehe Ausgabe von "cdk deploy").');
      }
      const clientId = String(input.clientId ?? '').trim();
      const clientSecret = String(input.clientSecret ?? '').trim() || (authenticated ? config?.clientSecret : '') || '';
      if (!/^[A-Za-z0-9]{16,64}$/.test(clientId)) throw badRequest('Ungültige Client-ID.');
      if (!/^[A-Za-z0-9]{16,64}$/.test(clientSecret)) throw badRequest('Ungültiges Client-Secret.');

      if (!deps.demo) await verifyClientCredentials(clientId, clientSecret);

      const now = new Date().toISOString();
      await store.putConfig({
        clientId,
        clientSecret,
        ownerId: config?.ownerId,
        ownerName: config?.ownerName,
        createdAt: config?.createdAt ?? now,
        updatedAt: now,
      });
      return json({ ok: true, loginUrl: '/api/auth/login' });
    },
    { public: true },
  );

  // ------------------------------------------------------------------ auth

  route(
    'GET',
    '/api/auth/login',
    async (req) => {
      const config = await store.getConfig();
      if (!config) return redirect('/setup');
      const state = randomBytes(16).toString('base64url');
      const cookie = serializeCookie(STATE_COOKIE, state, { maxAge: 600, secure: secure(req), path: '/api/auth' });
      const target = deps.demo
        ? `/api/auth/callback?code=demo&state=${state}`
        : authorizeUrl(config.clientId, redirectUri(req), state);
      return redirect(target, [cookie]);
    },
    { public: true },
  );

  route(
    'GET',
    '/api/auth/callback',
    async (req) => {
      const clearState = serializeCookie(STATE_COOKIE, '', { maxAge: 0, secure: secure(req), path: '/api/auth' });
      const fail = (code: string) => redirect(`/login?error=${encodeURIComponent(code)}`, [clearState]);
      if (req.query.error) return fail(req.query.error);
      const expected = req.cookies[STATE_COOKIE];
      if (!expected || !req.query.state || !safeEqual(expected, req.query.state)) return fail('state_mismatch');
      const config = await store.getConfig();
      if (!config) return redirect('/setup', [clearState]);

      let tokens: SpotifyTokens;
      let user: SpotifyUser;
      try {
        if (deps.oauth) {
          ({ tokens, user } = await deps.oauth(req.query.code ?? '', redirectUri(req)));
        } else if (deps.demo) {
          tokens = { accessToken: 'demo', refreshToken: 'demo', expiresAt: Date.now() + 3600_000, scope: SCOPES.join(' ') };
          user = await spotify.getMe();
        } else {
          tokens = await exchangeCode(config, req.query.code ?? '', redirectUri(req));
          user = await fetchMe(tokens.accessToken);
        }
      } catch (e) {
        console.error('OAuth callback failed', e);
        return fail(e instanceof ApiError ? e.code : 'token_exchange_failed');
      }

      if (config.ownerId && config.ownerId !== user.id) return fail('wrong_account');
      if (!config.ownerId || config.ownerName !== (user.display_name ?? undefined)) {
        await store.putConfig({
          ...config,
          ownerId: user.id,
          ownerName: user.display_name ?? undefined,
          updatedAt: new Date().toISOString(),
        });
      }
      const previous = await store.getTokens();
      await store.putTokens({ ...tokens, refreshToken: tokens.refreshToken || previous?.refreshToken || '' });

      const sessionId = randomBytes(32).toString('base64url');
      await store.putSession({
        id: sessionId,
        createdAt: new Date().toISOString(),
        expiresAt: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400,
      });
      const sessionCookie = serializeCookie(SESSION_COOKIE, sessionId, {
        maxAge: SESSION_DAYS * 86400,
        secure: secure(req),
      });

      const firstRun = (await store.listShows()).length === 0;
      if (firstRun) await startSync({});
      return redirect(firstRun ? '/?welcome=1' : '/', [clearState, sessionCookie]);
    },
    { public: true },
  );

  route(
    'POST',
    '/api/auth/logout',
    async (req) => {
      const id = req.cookies[SESSION_COOKIE];
      if (id) await store.deleteSession(id);
      return { status: 200, body: { ok: true }, cookies: [serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: secure(req) })] };
    },
    { public: true },
  );

  // ----------------------------------------------------------------- today

  route('GET', '/api/today', async (req) => {
    const tz = validTimeZone(req.query.tz);
    const [shows, settings, history, [today]] = await Promise.all([
      store.listShows(),
      store.getSettings(),
      store.listHistory(5),
      planner.week(tz, 1),
    ]);
    const recent: HistoryItem[] = history.map((p) => ({
      showId: p.showId,
      episodeId: p.episodeId,
      showName: p.showName,
      episodeName: p.episodeName,
      status: p.status,
      at: p.listenedAt ?? p.updatedAt,
    }));
    return json(buildToday(shows, settings, recent, today.items));
  });

  route('GET', '/api/history', async (req) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    return json(await store.listHistory(limit));
  });

  // ----------------------------------------------------------------- shows

  route('GET', '/api/shows', async () => {
    const shows = await store.listShows();
    shows.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    return json(shows);
  });

  route('POST', '/api/shows/reorder', async (req) => {
    await library.reorder(body<{ ids: string[] }>(req).ids ?? []);
    return json({ ok: true });
  });

  route('GET', '/api/shows/:id', async (_req, p) => json(await library.detail(p.id)));

  route('PATCH', '/api/shows/:id', async (req, p) => json(await library.updateSettings(p.id, body<ShowSettingsPatch>(req))));

  route('POST', '/api/shows/:id/sync', async (_req, p) => {
    await library.requireShow(p.id);
    return json(await startSync({ showId: p.id }), 202);
  });

  route('GET', '/api/shows/:id/episodes/:episodeId', async (_req, p) => json(await library.episode(p.id, p.episodeId)));

  route('PUT', '/api/shows/:id/episodes/:episodeId/status', async (req, p) => {
    const { status } = body<{ status: EpisodeStatus | null }>(req);
    return json(await library.setStatus(p.id, [p.episodeId], status ?? null));
  });

  route('POST', '/api/shows/:id/episodes/:episodeId/complete-before', async (_req, p) =>
    json(await library.completeBefore(p.id, p.episodeId)),
  );

  // ------------------------------------------------------------ weekly plan

  route('GET', '/api/schedule', async () => json(await store.getSchedule()));

  route('PUT', '/api/schedule', async (req) => json(await planner.saveSchedule(req.body)));

  route('GET', '/api/week', async (req) => {
    const days = await planner.week(validTimeZone(req.query.tz), Number(req.query.days) || 7, req.query.start);
    return json({ days });
  });

  // ----------------------------------------------------------------- notes

  route('GET', '/api/notes', async (req) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    return json(await store.listNotes(limit));
  });

  route('GET', '/api/shows/:id/episodes/:episodeId/note', async (_req, p) => {
    return json((await store.getNote(p.id, p.episodeId)) ?? null);
  });

  route('PUT', '/api/shows/:id/episodes/:episodeId/note', async (req, p) => {
    const { text } = body<{ text: string }>(req);
    return json(await library.saveNote(p.id, p.episodeId, text ?? ''));
  });

  // ------------------------------------------------------------------ sync

  route('POST', '/api/sync', async (req) => {
    const { full } = body<{ full: boolean }>(req);
    return json(await startSync({ full: !!full }), 202);
  });

  // -------------------------------------------------------------- settings

  route('GET', '/api/settings', async () => json(await store.getSettings()));

  route('PUT', '/api/settings', async (req) => {
    const input = body<Settings>(req);
    const current = await store.getSettings();
    const num = (v: unknown, min: number, max: number, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
    };
    const next: Settings = {
      audioBudgetMinutes: num(input.audioBudgetMinutes ?? current.audioBudgetMinutes, 0, 600, current.audioBudgetMinutes),
      budgetTolerancePercent: num(input.budgetTolerancePercent ?? current.budgetTolerancePercent, 0, 100, 10),
      newWindowDays: num(input.newWindowDays ?? current.newWindowDays, 1, 90, current.newWindowDays),
      useSpotifyPlayedState: Boolean(input.useSpotifyPlayedState ?? current.useSpotifyPlayedState),
      autoCompleteInPlayer: Boolean(input.autoCompleteInPlayer ?? current.autoCompleteInPlayer),
      categories: Array.isArray(input.categories)
        ? [...new Set(input.categories.map((c) => String(c).trim()).filter(Boolean))].slice(0, 50)
        : current.categories,
    };
    if (!next.categories.length) next.categories = DEFAULT_SETTINGS.categories;
    await store.putSettings(next);
    if (next.newWindowDays !== current.newWindowDays || next.useSpotifyPlayedState !== current.useSpotifyPlayedState) {
      await library.recomputeAll();
    }
    return json(next);
  });

  // ---------------------------------------------------------------- player

  route('GET', '/api/player/token', async () => json(await spotify.getAccessToken()));

  route('GET', '/api/player/devices', async () => {
    const devices: PlayerDevice[] = (await spotify.getDevices())
      .filter((d) => d.id && !d.is_restricted)
      .map((d) => ({ id: d.id!, name: d.name, type: d.type, isActive: d.is_active }));
    return json(devices);
  });

  route('POST', '/api/player/play', async (req) => {
    const { showId, episodeId, deviceId, fromStart, positionMs: requested } = body<{
      showId: string;
      episodeId: string;
      deviceId?: string;
      fromStart?: boolean;
      /** Explicit start position, e.g. from a timestamp in a note. */
      positionMs?: number;
    }>(req);
    if (!showId || !episodeId) throw badRequest('showId und episodeId sind erforderlich');
    const cached = await store.getEpisode(showId, episodeId);
    if (!cached) throw notFound('Folge nicht gefunden');

    // Fetch the episode fresh so we resume where Spotify left off.
    const fresh = await spotify.getEpisode(episodeId);
    let positionMs = 0;
    if (fresh) {
      const ep = toEpisode(fresh, showId, cached.firstSeenAt, new Date().toISOString());
      await store.putEpisodes([ep]);
      if (!fromStart && ep.resumePoint && !ep.resumePoint.fullyPlayed) positionMs = ep.resumePoint.resumePositionMs;
    }
    if (typeof requested === 'number' && Number.isFinite(requested) && requested >= 0) {
      positionMs = Math.min(requested, Math.max(0, cached.durationMs - 1000));
    }
    await spotify.play(episodeId, deviceId || undefined, positionMs);
    return json({ ok: true, positionMs, durationMs: cached.durationMs });
  });

  // ------------------------------------------------------------------ data

  route('GET', '/api/export', async () => {
    const [shows, settings, schedule, notes] = await Promise.all([
      store.listShows(),
      store.getSettings(),
      store.getSchedule(),
      store.listNotes(10_000),
    ]);
    const progress = await Promise.all(shows.map(async (s) => [...(await store.listProgress(s.id)).values()]));
    return {
      status: 200,
      headers: { 'Content-Disposition': 'attachment; filename="podcast-manager-export.json"' },
      body: {
        exportedAt: new Date().toISOString(),
        settings,
        shows: shows.map(({ summary: _summary, ...s }) => s),
        progress: progress.flat(),
        schedule,
        notes,
      },
    };
  });

  route('DELETE', '/api/data', async (req) => {
    await store.deleteAll();
    return { status: 200, body: { ok: true }, cookies: [serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: secure(req) })] };
  });

  // -------------------------------------------------------------- dispatch

  return async function handle(req: HttpRequest): Promise<HttpResponse> {
    try {
      const method = req.method.toUpperCase();
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !String(req.headers['content-type'] ?? '').includes('application/json')) {
        // Simple CSRF guard: cross-site forms cannot send JSON without a CORS preflight.
        throw new ApiError(415, 'unsupported_media_type', 'Content-Type application/json erforderlich');
      }
      let pathMatched = false;
      for (const r of routes) {
        const m = r.pattern.exec(req.path);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method) continue;
        if (!r.public && !(await isAuthenticated(req))) throw unauthorized();
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const res = await r.handler(req, params);
        return { ...res, headers: { 'Cache-Control': 'no-store', ...res.headers } };
      }
      if (pathMatched) throw new ApiError(405, 'method_not_allowed', 'Methode nicht erlaubt');
      throw notFound('Unbekannter Endpunkt');
    } catch (e) {
      if (e instanceof ApiError) {
        return { status: e.status, headers: { 'Cache-Control': 'no-store' }, body: { error: e.code, message: e.message } };
      }
      console.error('Unhandled error', e);
      return {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
        body: { error: 'internal', message: 'Interner Fehler – Details im CloudWatch-Log.' },
      };
    }
  };
}

async function fetchMe(accessToken: string): Promise<SpotifyUser> {
  const res = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 403) {
    throw new ApiError(403, 'spotify_user_not_allowed', 'Dieser Spotify-Account ist nicht in der User-Liste der Spotify-App.');
  }
  if (!res.ok) throw new ApiError(502, 'spotify_error', `Spotify /me fehlgeschlagen (${res.status})`);
  return (await res.json()) as SpotifyUser;
}

/** Uses the client-credentials grant purely to check that ID and secret are valid. */
async function verifyClientCredentials(clientId: string, clientSecret: string) {
  let res: Response;
  try {
    res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
  } catch {
    return; // network trouble – don't block setup, the OAuth flow will tell
  }
  if (res.status === 400 || res.status === 401) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (j.error === 'invalid_client') {
      throw new ApiError(400, 'spotify_invalid_client', 'Spotify kennt diese Client-ID/Secret-Kombination nicht.');
    }
  }
}

