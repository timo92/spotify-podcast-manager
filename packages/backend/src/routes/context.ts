import type { Context } from 'hono';
import type { AuthService } from '../services/auth.js';
import type { DataService } from '../services/data.js';
import type { LibraryService } from '../services/library.js';
import type { NoteService } from '../services/notes.js';
import type { PlanService } from '../services/plan.js';
import type { PlaybackService } from '../services/playback.js';
import type { SettingsService } from '../services/settings.js';
import type { SyncLauncher } from '../services/sync.js';
import type { SpotifyAuth } from '../spotify/auth.js';
import type { SpotifyCredentialsProvider } from '../spotify/credentials.js';
import type { Store } from '../store/types.js';

/** What every route module gets: the services, and the web details of this deployment. */
export interface RouteContext {
  store: Store;
  auth: AuthService;
  oauth: SpotifyAuth;
  credentials: SpotifyCredentialsProvider;
  data: DataService;
  library: LibraryService;
  notes: NoteService;
  planner: PlanService;
  playback: PlaybackService;
  settings: SettingsService;
  sync: SyncLauncher;
  web: Web;
}

export const SESSION_COOKIE = 'pm_session';

/** URLs and cookie settings, which depend on the host the app is reached under. */
export interface Web {
  /** Spotify's redirect target after login. */
  redirectUri: (c: Context) => string;
  cookieOptions: (
    c: Context,
    opts?: { path?: string; sameSite?: 'Strict' | 'Lax' },
  ) => { path: string; httpOnly: true; sameSite: 'Strict' | 'Lax'; secure: boolean };
}

/** `publicUrl` from the deployment, or the host the request came in under. */
export function web(publicUrl: string | undefined): Web {
  const baseUrl = (c: Context) => {
    if (publicUrl) return publicUrl.replace(/\/$/, '');
    // CloudFront sets x-public-host to the viewer's host (see infra ForwardHost function).
    const host =
      c.req.header('x-public-host') ?? c.req.header('x-forwarded-host') ?? c.req.header('host') ?? 'localhost';
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    return `${local ? 'http' : 'https'}://${host}`;
  };
  return {
    redirectUri: (c) => `${baseUrl(c)}/api/auth/callback`,
    cookieOptions: (c, opts = {}) => ({
      path: opts.path ?? '/',
      httpOnly: true,
      sameSite: opts.sameSite ?? 'Strict',
      secure: baseUrl(c).startsWith('https://'),
    }),
  };
}
