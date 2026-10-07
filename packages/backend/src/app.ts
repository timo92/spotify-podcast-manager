import { ORIGIN_VERIFY_HEADER, type ApiErrorBody } from '@podcast/shared';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { getCookie } from 'hono/cookie';
import { StatusCodes } from 'http-status-codes';
import { ApiError, unauthorized } from './errors.js';
import { authRoutes } from './routes/auth.js';
import { SESSION_COOKIE, web, type RouteContext } from './routes/context.js';
import { dataRoutes } from './routes/data.js';
import { isJsonRequest, safeEqual } from './routes/http.js';
import { libraryRoutes } from './routes/library.js';
import { noteRoutes } from './routes/notes.js';
import { planRoutes } from './routes/plan.js';
import { playerRoutes } from './routes/player.js';
import { AuthService } from './services/auth.js';
import { DataService } from './services/data.js';
import { LibraryService } from './services/library.js';
import { NoteService } from './services/notes.js';
import { PlanService } from './services/plan.js';
import { PlaybackService } from './services/playback.js';
import { SettingsService } from './services/settings.js';
import { SyncLauncher, type SyncOptions } from './services/sync.js';
import { UpNextService } from './services/up-next.js';
import { spotifyAuth, type SpotifyAuth } from './spotify/auth.js';
import type { SpotifyCredentialsProvider } from './spotify/credentials.js';
import type { SpotifyApi } from './spotify/types.js';
import type { Store } from './store/types.js';

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
  /**
   * Value CloudFront sends in `x-origin-verify`; requests without it are
   * refused. Unset locally, where there is no CloudFront.
   */
  originSecret?: string;
}

/** Endpoints reachable without a session. */
const PUBLIC_PATHS = new Set(['/api/status', '/api/auth/login', '/api/auth/callback', '/api/auth/logout']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The API: guards for every request, then the route modules under /api. */
export function createApp(deps: AppDeps) {
  const { store } = deps;
  const library = new LibraryService(store);
  const planner = new PlanService(store, library);
  const upNext = new UpNextService(store, planner, deps.spotify);
  const ctx: RouteContext = {
    store,
    auth: new AuthService(store, deps.credentials),
    oauth: deps.auth ?? spotifyAuth,
    credentials: deps.credentials,
    data: new DataService(store),
    library,
    notes: new NoteService(store, library, deps.spotify),
    planner,
    playback: new PlaybackService(store, library, deps.spotify, upNext),
    settings: new SettingsService(store, library),
    sync: new SyncLauncher(store, deps.triggerSync),
    upNext,
    web: web(deps.publicUrl),
  };

  const app = new Hono();

  const { originSecret } = deps;
  if (originSecret) {
    app.use('/api/*', async (c, next) => {
      if (!safeEqual(c.req.header(ORIGIN_VERIFY_HEADER) ?? '', originSecret)) {
        throw new ApiError(StatusCodes.FORBIDDEN, 'origin_forbidden', 'Nur über CloudFront erreichbar');
      }
      await next();
    });
  }
  app.use('/api/*', compress());

  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    // Simple CSRF guard: cross-site forms cannot send JSON without a CORS preflight.
    if (MUTATING_METHODS.has(c.req.method) && !isJsonRequest(c)) {
      throw new ApiError(
        StatusCodes.UNSUPPORTED_MEDIA_TYPE,
        'unsupported_media_type',
        'Content-Type application/json erforderlich',
      );
    }
    if (!PUBLIC_PATHS.has(c.req.path) && !(await ctx.auth.isAuthenticated(getCookie(c, SESSION_COOKIE)))) {
      throw unauthorized();
    }
    await next();
  });

  app.onError((err, c) => {
    c.header('Cache-Control', 'no-store');
    if (err instanceof ApiError) {
      const body: ApiErrorBody = { error: err.code, message: err.message, params: err.params };
      return c.json(body, err.status as never);
    }
    console.error('Unhandled error', err);
    const body: ApiErrorBody = { error: 'internal', message: 'Interner Fehler – Details im CloudWatch-Log.' };
    return c.json(body, StatusCodes.INTERNAL_SERVER_ERROR);
  });

  app.notFound((c) => {
    const body: ApiErrorBody = { error: 'not_found', message: 'Unbekannter Endpunkt' };
    return c.json(body, StatusCodes.NOT_FOUND);
  });

  for (const routes of [authRoutes, libraryRoutes, planRoutes, noteRoutes, playerRoutes, dataRoutes]) {
    app.route('/api', routes(ctx));
  }
  return app;
}

export type App = ReturnType<typeof createApp>;
