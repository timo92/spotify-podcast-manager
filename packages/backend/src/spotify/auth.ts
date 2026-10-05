import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../errors.js';
import type { AppConfig, SpotifyTokens } from '../store/types.js';
import { authorizeUrl, exchangeCode } from './client.js';
import type { SpotifyUser } from './types.js';

/**
 * The login side of Spotify (OAuth + credential check). Injected into the app
 * so local development and tests can swap in a fake without the app knowing.
 */
export interface SpotifyAuth {
  authorizeUrl(clientId: string, redirectUri: string, state: string): string;
  /** Exchanges the OAuth code and identifies the Spotify user. */
  login(
    config: Pick<AppConfig, 'clientId' | 'clientSecret'>,
    code: string,
    redirectUri: string,
  ): Promise<{ tokens: SpotifyTokens; user: SpotifyUser }>;
  /** Throws if Spotify rejects the client ID/secret. */
  verifyCredentials(clientId: string, clientSecret: string): Promise<void>;
}

export const spotifyAuth: SpotifyAuth = {
  authorizeUrl,

  async login(config, code, redirectUri) {
    const tokens = await exchangeCode(config, code, redirectUri);
    return { tokens, user: await fetchMe(tokens.accessToken) };
  },

  /** Uses the client-credentials grant purely to check that ID and secret are valid. */
  async verifyCredentials(clientId, clientSecret) {
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
    if (res.status === StatusCodes.BAD_REQUEST || res.status === StatusCodes.UNAUTHORIZED) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (j.error === 'invalid_client') {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          'spotify_invalid_client',
          'Spotify kennt diese Client-ID/Secret-Kombination nicht.',
        );
      }
    }
  },
};

async function fetchMe(accessToken: string): Promise<SpotifyUser> {
  const res = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === StatusCodes.FORBIDDEN) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'spotify_user_not_allowed',
      'Dieser Spotify-Account ist nicht in der User-Liste der Spotify-App.',
    );
  }
  if (!res.ok) throw new ApiError(StatusCodes.BAD_GATEWAY, 'spotify_error', `Spotify /me fehlgeschlagen (${res.status})`);
  return (await res.json()) as SpotifyUser;
}
