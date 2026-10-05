import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../errors.js';
import type { SpotifyTokens } from '../store/types.js';
import { authorizeUrl, exchangeCode } from './client.js';
import type { SpotifyCredentials } from './credentials.js';
import type { SpotifyUser } from './types.js';

/**
 * The login side of Spotify (OAuth). Injected into the app so local
 * development and tests can swap in a fake without the app knowing.
 */
export interface SpotifyAuth {
  authorizeUrl(clientId: string, redirectUri: string, state: string): string;
  /** Exchanges the OAuth code and identifies the Spotify user. */
  login(
    credentials: SpotifyCredentials,
    code: string,
    redirectUri: string,
  ): Promise<{ tokens: SpotifyTokens; user: SpotifyUser }>;
}

export const spotifyAuth: SpotifyAuth = {
  authorizeUrl,

  async login(credentials, code, redirectUri) {
    const tokens = await exchangeCode(credentials, code, redirectUri);
    return { tokens, user: await fetchMe(tokens.accessToken) };
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
