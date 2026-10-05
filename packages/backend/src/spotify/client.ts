import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../errors.js';
import type { SpotifyTokens, Store } from '../store/types.js';
import type { SpotifyCredentials, SpotifyCredentialsProvider } from './credentials.js';
import type {
  SpotifyApi,
  SpotifyDevice,
  SpotifyEpisode,
  SpotifyPage,
  SpotifyShow,
  SpotifyUser,
  TokenResponse,
} from './types.js';

const API = 'https://api.spotify.com/v1';
const ACCOUNTS = 'https://accounts.spotify.com';

/**
 * Scopes we ask for:
 *  - user-library-read: list saved shows ("Your Library → Podcasts") and check
 *    whether a show is still saved
 *  - user-read-playback-position: resume points / "fully played" of episodes
 *  - streaming, user-read-email, user-read-private: Web Playback SDK (Premium)
 *  - user-read-playback-state, user-modify-playback-state: start playback on
 *    the browser player or any other Spotify Connect device
 */
export const SCOPES = [
  'user-library-read',
  'user-read-playback-position',
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
];

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES.join(' '),
    redirect_uri: redirectUri,
    state,
  });
  return `${ACCOUNTS}/authorize?${params}`;
}

async function tokenRequest(credentials: SpotifyCredentials, body: URLSearchParams) {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
    },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    const detail = json.error_description ?? json.error ?? res.statusText;
    if (json.error === 'invalid_client') {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'spotify_invalid_client', `Spotify lehnt Client-ID/Secret ab (${detail}).`, {
        detail,
      });
    }
    if (json.error === 'invalid_grant') {
      throw new ApiError(StatusCodes.UNAUTHORIZED, 'spotify_reauth', `Spotify-Anmeldung abgelaufen, bitte neu anmelden (${detail}).`, {
        detail,
      });
    }
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'spotify_token_error', `Spotify-Token-Fehler: ${detail}`, { detail });
  }
  return json;
}

export async function exchangeCode(
  credentials: SpotifyCredentials,
  code: string,
  redirectUri: string,
): Promise<SpotifyTokens> {
  const json = await tokenRequest(
    credentials,
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  );
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? '',
    expiresAt: Date.now() + json.expires_in * 1000,
    scope: json.scope ?? '',
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Thin, typed wrapper around the Spotify Web API.
 *
 * Only documented, non-deprecated endpoints are used. Notes on the February
 * 2026 changes for development-mode apps: the batch endpoints
 * `GET /shows` and `GET /episodes` were removed (we don't use them), the show
 * `publisher` field was dropped (treated as optional), and the app owner needs
 * Premium. See docs/spotify-api.md.
 */
export class HttpSpotifyApi implements SpotifyApi {
  private tokens?: SpotifyTokens;

  constructor(
    private readonly store: Store,
    private readonly credentials: SpotifyCredentialsProvider,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async validToken(forceRefresh = false): Promise<string> {
    this.tokens ??= await this.store.getTokens();
    if (!this.tokens) throw new ApiError(StatusCodes.UNAUTHORIZED, 'spotify_not_connected', 'Spotify ist nicht verbunden.');
    if (forceRefresh || this.tokens.expiresAt - 60_000 < Date.now()) {
      let json: TokenResponse;
      try {
        json = await tokenRequest(
          await this.credentials.get(),
          new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.tokens.refreshToken }),
        );
      } catch (e) {
        if (e instanceof ApiError && e.code === 'spotify_reauth') await this.disconnect(this.tokens.refreshToken);
        throw e;
      }
      this.tokens = {
        accessToken: json.access_token,
        // Spotify may rotate refresh tokens – keep the new one if present.
        refreshToken: json.refresh_token ?? this.tokens.refreshToken,
        expiresAt: Date.now() + json.expires_in * 1000,
        scope: json.scope ?? this.tokens.scope,
      };
      await this.store.putTokens(this.tokens);
    }
    return this.tokens.accessToken;
  }

  /**
   * Spotify rejected the refresh token (`invalid_grant`), i.e. the user revoked
   * access. Spotify's Developer Policy then requires that we stop requesting
   * their data: drop the tokens now; the rest is deleted by the retention rules
   * unless the user logs in again (services/retention.ts).
   */
  private async disconnect(rejectedRefreshToken: string) {
    this.tokens = undefined;
    // Our cached tokens may be outdated: a refresh elsewhere or a new login may
    // have stored valid ones meanwhile. Only revoke what Spotify actually rejected.
    if (!(await this.store.deleteTokens(rejectedRefreshToken))) return;
    await this.store.markDisconnected(new Date().toISOString());
  }

  private async request<T>(method: string, pathOrUrl: string, body?: unknown): Promise<T | undefined> {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API}${pathOrUrl}`;
    let refreshed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = await this.validToken();
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (res.status === StatusCodes.NO_CONTENT || res.status === StatusCodes.ACCEPTED) return undefined;
      if (res.ok) {
        const text = await res.text();
        return text ? (JSON.parse(text) as T) : undefined;
      }

      if (res.status === StatusCodes.UNAUTHORIZED && !refreshed) {
        refreshed = true;
        await this.validToken(true);
        continue;
      }
      if (res.status === StatusCodes.TOO_MANY_REQUESTS) {
        const retryAfter = Number(res.headers.get('retry-after') ?? '1');
        if (retryAfter > 20) {
          throw new ApiError(
            StatusCodes.TOO_MANY_REQUESTS,
            'spotify_rate_limited',
            `Spotify-Rate-Limit erreicht, bitte in ${Math.ceil(retryAfter / 60)} Minuten erneut versuchen.`,
            { minutes: Math.ceil(retryAfter / 60) },
          );
        }
        await sleep((retryAfter + 0.5) * 1000);
        continue;
      }
      if (res.status >= StatusCodes.INTERNAL_SERVER_ERROR && attempt < 2) {
        await sleep(500 * (attempt + 1));
        continue;
      }

      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string; reason?: string } };
      const message = err.error?.message ?? res.statusText;
      if (res.status === StatusCodes.UNAUTHORIZED) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, 'spotify_reauth', `Spotify-Zugriff abgelaufen, bitte neu anmelden. (${message})`, {
          detail: message,
        });
      }
      if (res.status === StatusCodes.FORBIDDEN) {
        throw new ApiError(
          StatusCodes.FORBIDDEN,
          'spotify_forbidden',
          `Spotify verweigert den Zugriff (${message}). Mögliche Ursachen: fehlende Berechtigung (bitte neu anmelden), ` +
            `Account nicht in der User-Liste der Spotify-App oder kein Premium beim App-Owner.`,
          { detail: message },
        );
      }
      if (res.status === StatusCodes.NOT_FOUND && err.error?.reason === 'NO_ACTIVE_DEVICE') {
        throw new ApiError(StatusCodes.CONFLICT, 'no_active_device', 'Kein aktives Spotify-Gerät gefunden. Öffne Spotify auf einem Gerät.');
      }
      throw new ApiError(
        res.status === StatusCodes.NOT_FOUND ? StatusCodes.NOT_FOUND : StatusCodes.BAD_GATEWAY,
        'spotify_error',
        `Spotify-Fehler ${res.status}: ${message}`,
        { status: res.status, detail: message },
      );
    }
    throw new ApiError(StatusCodes.BAD_GATEWAY, 'spotify_unavailable', 'Spotify antwortet nicht – bitte später erneut versuchen.');
  }

  async getMe() {
    return (await this.request<SpotifyUser>('GET', '/me'))!;
  }

  async getSavedShows() {
    const shows: SpotifyShow[] = [];
    let url: string | null = '/me/shows?limit=50';
    while (url) {
      const page: SpotifyPage<{ show: SpotifyShow | null }> | undefined = await this.request('GET', url);
      if (!page) break;
      for (const item of page.items) if (item?.show) shows.push(item.show);
      url = page.next;
    }
    return shows;
  }

  async libraryContains(showIds: string[]) {
    const result = new Map<string, boolean>();
    // The endpoint takes up to 40 Spotify URIs per call and answers with booleans in the same order.
    for (let i = 0; i < showIds.length; i += 40) {
      const ids = showIds.slice(i, i + 40);
      const uris = ids.map((id) => `spotify:show:${id}`).join(',');
      const saved = (await this.request<boolean[]>('GET', `/me/library/contains?uris=${encodeURIComponent(uris)}`)) ?? [];
      if (saved.length !== ids.length) {
        throw new ApiError(StatusCodes.BAD_GATEWAY, 'spotify_unexpected_response', 'Unerwartete Antwort von /me/library/contains', {
          detail: '/me/library/contains',
        });
      }
      ids.forEach((id, k) => result.set(id, saved[k] === true));
    }
    return result;
  }

  async getShowEpisodes(showId: string, stopAfterPage?: (page: SpotifyEpisode[]) => boolean) {
    const episodes: SpotifyEpisode[] = [];
    let url: string | null = `/shows/${encodeURIComponent(showId)}/episodes?limit=50`;
    while (url) {
      const page: SpotifyPage<SpotifyEpisode> | undefined = await this.request('GET', url);
      if (!page) break;
      const items = page.items.filter((e): e is SpotifyEpisode => !!e?.id);
      episodes.push(...items);
      if (stopAfterPage?.(items)) break;
      url = page.next;
    }
    return episodes;
  }

  async getEpisode(episodeId: string) {
    try {
      return await this.request<SpotifyEpisode>('GET', `/episodes/${encodeURIComponent(episodeId)}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === StatusCodes.NOT_FOUND) return undefined;
      throw e;
    }
  }

  async getDevices() {
    const res = await this.request<{ devices: SpotifyDevice[] }>('GET', '/me/player/devices');
    return res?.devices ?? [];
  }

  async play(episodeId: string, deviceId: string | undefined, positionMs: number) {
    const qs = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
    await this.request('PUT', `/me/player/play${qs}`, {
      uris: [`spotify:episode:${episodeId}`],
      position_ms: Math.max(0, Math.floor(positionMs)),
    });
  }

  async getAccessToken() {
    const accessToken = await this.validToken();
    return { accessToken, expiresAt: this.tokens!.expiresAt };
  }
}
