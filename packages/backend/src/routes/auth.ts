import { randomBytes } from 'node:crypto';
import type { ErrorCode, LoginErrorCode } from '@podcast/shared';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { ApiError } from '../errors.js';
import { SESSION_SECONDS, type SpotifyLogin } from '../services/auth.js';
import { SESSION_COOKIE, type RouteContext } from './context.js';
import { safeEqual } from './http.js';

const STATE_COOKIE = 'pm_oauth_state';

/** Back to the login page, which explains the error codes it knows. */
const toLogin = (c: Context, error: string) => c.redirect(`/login?error=${encodeURIComponent(error)}`);

/** Status, Spotify login (OAuth) and logout. */
export function authRoutes({ auth, oauth, credentials, sync, web }: RouteContext) {
  // The OAuth state cookie must be Lax: Spotify's redirect back to the callback is a
  // cross-site navigation, and browsers drop Strict cookies on those.
  const stateCookieOptions = (c: Context) => web.cookieOptions(c, { path: '/api/auth', sameSite: 'Lax' });

  return new Hono()
    .get('/status', async (c) => {
      const authenticated = await auth.isAuthenticated(getCookie(c, SESSION_COOKIE));
      return c.json(await auth.status(authenticated, web.redirectUri(c)));
    })
    .get('/auth/login', async (c) => {
      if (!credentials.clientId) return toLogin(c, 'not_configured' satisfies LoginErrorCode);
      const state = randomBytes(16).toString('base64url');
      setCookie(c, STATE_COOKIE, state, { ...stateCookieOptions(c), maxAge: 600 });
      return c.redirect(oauth.authorizeUrl(credentials.clientId, web.redirectUri(c), state));
    })
    .get('/auth/callback', async (c) => {
      const expected = getCookie(c, STATE_COOKIE);
      deleteCookie(c, STATE_COOKIE, stateCookieOptions(c));
      const fail = (code: LoginErrorCode | ErrorCode) => toLogin(c, code);
      const { error, state, code } = c.req.query();
      // Spotify's own OAuth error is passed on as it is; the login page explains the ones it knows.
      if (error) return toLogin(c, error);
      if (!expected || !state || !safeEqual(expected, state)) return fail('state_mismatch');
      if (!code) return fail('token_exchange_failed');

      let login: SpotifyLogin;
      try {
        login = await oauth.login(await credentials.get(), code, web.redirectUri(c));
      } catch (e) {
        console.error('OAuth callback failed', e);
        return fail(e instanceof ApiError ? e.code : 'token_exchange_failed');
      }
      // The callback is a page navigation: a failure must land on the login page, not show JSON.
      let session: Awaited<ReturnType<typeof auth.login>>;
      try {
        session = await auth.login(login);
      } catch (e) {
        console.error('Login could not be stored', e);
        return fail('login_failed');
      }
      if (!session) return fail('wrong_account');
      // Strict: the session is only ever needed by the SPA's same-origin fetches.
      setCookie(c, SESSION_COOKIE, session.sessionId, { ...web.cookieOptions(c), maxAge: SESSION_SECONDS });
      if (!session.firstRun) return c.redirect('/');
      // A failed start must not fail the login; the sync state shows the error and
      // the user can start the import again.
      await sync.start({}).catch((e: unknown) => console.error('Initial sync could not start', e));
      return c.redirect('/?welcome=1');
    })
    .post('/auth/logout', async (c) => {
      await auth.logout(getCookie(c, SESSION_COOKIE));
      deleteCookie(c, SESSION_COOKIE, web.cookieOptions(c));
      return c.json({ ok: true });
    });
}
