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
import { Hono, type Context } from 'hono';
import { compress } from 'hono/compress';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { StatusCodes } from 'http-status-codes';
import { ApiError, badRequest, notFound, unauthorized } from './errors.js';
import { LibraryService } from './services/library.js';
import { PlanService, validTimeZone } from './services/plan.js';
import { isSyncRunning, toEpisode, type SyncOptions } from './services/sync.js';
import { spotifyAuth, type SpotifyAuth } from './spotify/auth.js';
import { SCOPES } from './spotify/client.js';
import type { SpotifyCredentialsProvider } from './spotify/credentials.js';
import type { SpotifyApi } from './spotify/types.js';
import type { SpotifyTokens, Store } from './store/types.js';

export interface AppDeps {
  store: Store;
  /** Creates a Spotify client; called once per request so token state never leaks between requests. */
  spotify: () => SpotifyApi;
  /** Client ID/secret of the Spotify developer app, from the deployment. */
  credentials: SpotifyCredentialsProvider;
  /** OAuth login; defaults to the real Spotify accounts service. */
  auth?: SpotifyAuth;
  /** Starts a sync in the background (async Lambda invocation / in-process locally). */
  triggerSync: (opts: SyncOptions) => Promise<void>;
  /** Public base URL, e.g. https://podcasts.example.com. Derived from headers if unset. */
  publicUrl?: string;
}

const SESSION_COOKIE = 'pm_session';
const STATE_COOKIE = 'pm_oauth_state';
const SESSION_DAYS = 90;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

/** Endpoints reachable without a session. */
const PUBLIC_PATHS = new Set(['/api/status', '/api/auth/login', '/api/auth/callback', '/api/auth/logout']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** JSON body of the request; `{}` when empty. */
async function readBody<T>(c: Context): Promise<Partial<T>> {
  const text = await c.req.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<T>) : {};
  } catch {
    throw badRequest('Ungültiges JSON');
  }
}

export function createApp(deps: AppDeps) {
  const { store } = deps;
  const auth = deps.auth ?? spotifyAuth;
  const library = new LibraryService(store);
  const planner = new PlanService(store, library);
  const app = new Hono();

  const baseUrl = (c: Context) => {
    if (deps.publicUrl) return deps.publicUrl.replace(/\/$/, '');
    // CloudFront sets x-public-host to the viewer's host (see infra ForwardHost function).
    const host = c.req.header('x-public-host') ?? c.req.header('x-forwarded-host') ?? c.req.header('host') ?? 'localhost';
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    return `${local ? 'http' : 'https'}://${host}`;
  };
  const redirectUri = (c: Context) => `${baseUrl(c)}/api/auth/callback`;
  const cookieOptions = (c: Context, opts: { path?: string; sameSite?: 'Strict' | 'Lax' } = {}) =>
    ({
      path: opts.path ?? '/',
      httpOnly: true,
      sameSite: opts.sameSite ?? 'Strict',
      secure: baseUrl(c).startsWith('https://'),
    }) as const;
  // The OAuth state cookie must be Lax: Spotify's redirect back to the callback is a
  // cross-site navigation, and browsers drop Strict cookies on those.
  const stateCookieOptions = (c: Context) => cookieOptions(c, { path: '/api/auth', sameSite: 'Lax' });

  async function isAuthenticated(c: Context): Promise<boolean> {
    const id = getCookie(c, SESSION_COOKIE);
    return !!id && !!(await store.getSession(id));
  }

  async function startSync(opts: SyncOptions) {
    const state = await store.getSyncState();
    if (isSyncRunning(state)) return state;
    const next = { ...state, status: 'running' as const, startedAt: new Date().toISOString(), message: 'Gestartet…' };
    await store.putSyncState(next);
    await deps.triggerSync(opts);
    return next;
  }

  // ------------------------------------------------------------ middleware

  app.use('/api/*', compress());

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    // Simple CSRF guard: cross-site forms cannot send JSON without a CORS preflight.
    if (MUTATING_METHODS.has(c.req.method) && !(c.req.header('content-type') ?? '').includes('application/json')) {
      throw new ApiError(
        StatusCodes.UNSUPPORTED_MEDIA_TYPE,
        'unsupported_media_type',
        'Content-Type application/json erforderlich',
      );
    }
    if (!PUBLIC_PATHS.has(c.req.path) && !(await isAuthenticated(c))) throw unauthorized();
    await next();
  });

  app.onError((err, c) => {
    c.header('Cache-Control', 'no-store');
    if (err instanceof ApiError) return c.json({ error: err.code, message: err.message }, err.status as never);
    console.error('Unhandled error', err);
    return c.json(
      { error: 'internal', message: 'Interner Fehler – Details im CloudWatch-Log.' },
      StatusCodes.INTERNAL_SERVER_ERROR,
    );
  });

  app.notFound((c) => c.json({ error: 'not_found', message: 'Unbekannter Endpunkt' }, StatusCodes.NOT_FOUND));

  // ---------------------------------------------------------------- status

  app.get('/api/status', async (c) => {
    const [config, authenticated, configured] = await Promise.all([
      store.getConfig(),
      isAuthenticated(c),
      deps.credentials.ready(),
    ]);
    const status: AppStatus = {
      configured,
      authenticated,
      redirectUri: redirectUri(c),
      claimed: !!config,
    };
    if (authenticated) {
      const [tokens, sync] = await Promise.all([store.getTokens(), store.getSyncState()]);
      const granted = (tokens?.scope ?? '').split(' ').filter(Boolean);
      status.spotifyConnected = !!tokens;
      status.user = config?.ownerId ? { id: config.ownerId, displayName: config.ownerName } : undefined;
      status.sync = sync;
      status.grantedScopes = granted;
      status.missingScopes = tokens ? SCOPES.filter((s) => !granted.includes(s)) : [];
    }
    return c.json(status);
  });

  // ------------------------------------------------------------------ auth

  app.get('/api/auth/login', async (c) => {
    if (!deps.credentials.clientId) return c.redirect('/login?error=not_configured');
    const state = randomBytes(16).toString('base64url');
    setCookie(c, STATE_COOKIE, state, { ...stateCookieOptions(c), maxAge: 600 });
    return c.redirect(auth.authorizeUrl(deps.credentials.clientId, redirectUri(c), state));
  });

  app.get('/api/auth/callback', async (c) => {
    const expected = getCookie(c, STATE_COOKIE);
    deleteCookie(c, STATE_COOKIE, stateCookieOptions(c));
    const fail = (code: string) => c.redirect(`/login?error=${encodeURIComponent(code)}`);
    const { error, state, code } = c.req.query();
    if (error) return fail(error);
    if (!expected || !state || !safeEqual(expected, state)) return fail('state_mismatch');

    let login: { tokens: SpotifyTokens; user: { id: string; display_name?: string | null } };
    try {
      login = await auth.login(await deps.credentials.get(), code ?? '', redirectUri(c));
    } catch (e) {
      console.error('OAuth callback failed', e);
      return fail(e instanceof ApiError ? e.code : 'token_exchange_failed');
    }
    const { tokens, user } = login;

    // The first account that logs in becomes the owner. Only accounts listed under
    // "User Management" of the Spotify app can log in at all (development mode).
    const config = await store.getConfig();
    if (config && config.ownerId !== user.id) return fail('wrong_account');
    if (!config || config.ownerName !== (user.display_name ?? undefined)) {
      const now = new Date().toISOString();
      await store.putConfig({
        ownerId: user.id,
        ownerName: user.display_name ?? undefined,
        createdAt: config?.createdAt ?? now,
        updatedAt: now,
      });
    }
    const previous = await store.getTokens();
    await store.putTokens({ ...tokens, refreshToken: tokens.refreshToken || previous?.refreshToken || '' });

    const sessionId = randomBytes(32).toString('base64url');
    await store.putSession({
      id: sessionId,
      createdAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    });
    // Strict: the session is only ever needed by the SPA's same-origin fetches.
    setCookie(c, SESSION_COOKIE, sessionId, { ...cookieOptions(c), maxAge: SESSION_SECONDS });

    const firstRun = (await store.listShows()).length === 0;
    if (firstRun) await startSync({});
    return c.redirect(firstRun ? '/?welcome=1' : '/');
  });

  app.post('/api/auth/logout', async (c) => {
    const id = getCookie(c, SESSION_COOKIE);
    if (id) await store.deleteSession(id);
    deleteCookie(c, SESSION_COOKIE, cookieOptions(c));
    return c.json({ ok: true });
  });

  // ----------------------------------------------------------------- today

  app.get('/api/today', async (c) => {
    const tz = validTimeZone(c.req.query('tz'));
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
    return c.json(buildToday(shows, settings, recent, today.items));
  });

  app.get('/api/history', async (c) => {
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
    return c.json(await store.listHistory(limit));
  });

  // ----------------------------------------------------------------- shows

  app.get('/api/shows', async (c) => {
    const shows = await store.listShows();
    shows.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    return c.json(shows);
  });

  app.post('/api/shows/reorder', async (c) => {
    await library.reorder((await readBody<{ ids: string[] }>(c)).ids ?? []);
    return c.json({ ok: true });
  });

  app.get('/api/shows/:id', async (c) => c.json(await library.detail(c.req.param('id'))));

  app.patch('/api/shows/:id', async (c) =>
    c.json(await library.updateSettings(c.req.param('id'), await readBody<ShowSettingsPatch>(c))),
  );

  app.post('/api/shows/:id/sync', async (c) => {
    const id = c.req.param('id');
    await library.requireShow(id);
    return c.json(await startSync({ showId: id }), StatusCodes.ACCEPTED);
  });

  app.get('/api/shows/:id/episodes/:episodeId', async (c) =>
    c.json(await library.episode(c.req.param('id'), c.req.param('episodeId'))),
  );

  app.put('/api/shows/:id/episodes/:episodeId/status', async (c) => {
    const { status } = await readBody<{ status: EpisodeStatus | null }>(c);
    return c.json(await library.setStatus(c.req.param('id'), [c.req.param('episodeId')], status ?? null));
  });

  app.post('/api/shows/:id/episodes/:episodeId/complete-before', async (c) =>
    c.json(await library.completeBefore(c.req.param('id'), c.req.param('episodeId'))),
  );

  // ------------------------------------------------------------ weekly plan

  app.get('/api/schedule', async (c) => c.json(await store.getSchedule()));

  app.put('/api/schedule', async (c) => c.json(await planner.saveSchedule(await readBody(c))));

  app.get('/api/week', async (c) => {
    const days = await planner.week(
      validTimeZone(c.req.query('tz')),
      Number(c.req.query('days')) || 7,
      c.req.query('start'),
    );
    return c.json({ days });
  });

  // ----------------------------------------------------------------- notes

  app.get('/api/notes', async (c) => {
    const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 200));
    return c.json(await store.listNotes(limit));
  });

  app.get('/api/shows/:id/episodes/:episodeId/note', async (c) =>
    c.json((await store.getNote(c.req.param('id'), c.req.param('episodeId'))) ?? null),
  );

  app.put('/api/shows/:id/episodes/:episodeId/note', async (c) => {
    const { text } = await readBody<{ text: string }>(c);
    return c.json(await library.saveNote(c.req.param('id'), c.req.param('episodeId'), text ?? ''));
  });

  // ------------------------------------------------------------------ sync

  app.post('/api/sync', async (c) => {
    const { full } = await readBody<{ full: boolean }>(c);
    return c.json(await startSync({ full: !!full }), StatusCodes.ACCEPTED);
  });

  // -------------------------------------------------------------- settings

  app.get('/api/settings', async (c) => c.json(await store.getSettings()));

  app.put('/api/settings', async (c) => {
    const input = await readBody<Settings>(c);
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
        ? [...new Set(input.categories.map((cat) => String(cat).trim()).filter(Boolean))].slice(0, 50)
        : current.categories,
    };
    if (!next.categories.length) next.categories = DEFAULT_SETTINGS.categories;
    await store.putSettings(next);
    if (next.newWindowDays !== current.newWindowDays || next.useSpotifyPlayedState !== current.useSpotifyPlayedState) {
      await library.recomputeAll();
    }
    return c.json(next);
  });

  // ---------------------------------------------------------------- player

  app.get('/api/player/token', async (c) => c.json(await deps.spotify().getAccessToken()));

  app.get('/api/player/devices', async (c) => {
    const devices: PlayerDevice[] = (await deps.spotify().getDevices())
      .filter((d) => d.id && !d.is_restricted)
      .map((d) => ({ id: d.id!, name: d.name, type: d.type, isActive: d.is_active }));
    return c.json(devices);
  });

  app.post('/api/player/play', async (c) => {
    const { showId, episodeId, deviceId, fromStart, positionMs: requested } = await readBody<{
      showId: string;
      episodeId: string;
      deviceId?: string;
      fromStart?: boolean;
      /** Explicit start position, e.g. from a timestamp in a note. */
      positionMs?: number;
    }>(c);
    if (!showId || !episodeId) throw badRequest('showId und episodeId sind erforderlich');
    const cached = await store.getEpisode(showId, episodeId);
    if (!cached) throw notFound('Folge nicht gefunden');

    // Fetch the episode fresh so we resume where Spotify left off.
    const spotify = deps.spotify();
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
    return c.json({ ok: true, positionMs, durationMs: cached.durationMs });
  });

  // ------------------------------------------------------------------ data

  app.get('/api/export', async (c) => {
    const [shows, settings, schedule, notes] = await Promise.all([
      store.listShows(),
      store.getSettings(),
      store.getSchedule(),
      store.listNotes(10_000),
    ]);
    const progress = await Promise.all(shows.map(async (s) => [...(await store.listProgress(s.id)).values()]));
    c.header('Content-Disposition', 'attachment; filename="podcast-manager-export.json"');
    return c.json({
      exportedAt: new Date().toISOString(),
      settings,
      shows: shows.map(({ summary: _summary, ...s }) => s),
      progress: progress.flat(),
      schedule,
      notes,
    });
  });

  app.delete('/api/data', async (c) => {
    await store.deleteAll();
    deleteCookie(c, SESSION_COOKIE, cookieOptions(c));
    return c.json({ ok: true });
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
