import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../errors.js';

export interface SpotifyCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Where the Spotify developer app's credentials come from. They are part of
 * the deployment, not of the app's data: the client ID is a plain environment
 * variable, the secret comes from SSM Parameter Store (AWS) or an environment
 * variable (local development).
 */
export interface SpotifyCredentialsProvider {
  /** True when a client ID is configured; the secret is only resolved on use. */
  readonly configured: boolean;
  readonly clientId: string | undefined;
  get(): Promise<SpotifyCredentials>;
}

const CACHE_MS = 5 * 60 * 1000;

const notConfigured = (detail: string) =>
  new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'not_configured', `Spotify-Zugangsdaten fehlen: ${detail}`);

/**
 * Reads the credentials from the environment:
 *   SPOTIFY_CLIENT_ID                 the Spotify app's client ID
 *   SPOTIFY_CLIENT_SECRET             the secret itself (local development)
 *   SPOTIFY_CLIENT_SECRET_PARAMETER   name of an SSM SecureString holding the secret (AWS)
 * The secret is cached for a few minutes, so a changed parameter is picked up
 * without a redeploy.
 */
export function credentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  ssm: Pick<SSMClient, 'send'> = new SSMClient({}),
): SpotifyCredentialsProvider {
  const clientId = env.SPOTIFY_CLIENT_ID?.trim() || undefined;
  let cached: { value: SpotifyCredentials; at: number } | undefined;

  async function readSecret(): Promise<string> {
    if (env.SPOTIFY_CLIENT_SECRET?.trim()) return env.SPOTIFY_CLIENT_SECRET.trim();
    const name = env.SPOTIFY_CLIENT_SECRET_PARAMETER?.trim();
    if (!name) throw notConfigured('SPOTIFY_CLIENT_SECRET oder SPOTIFY_CLIENT_SECRET_PARAMETER ist nicht gesetzt.');
    try {
      const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
      const value = res.Parameter?.Value?.trim();
      if (!value) throw notConfigured(`Parameter ${name} ist leer.`);
      return value;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if ((e as { name?: string }).name === 'ParameterNotFound') {
        throw notConfigured(`Parameter ${name} existiert nicht (siehe README: "pnpm run secret:put").`);
      }
      throw e;
    }
  }

  return {
    configured: !!clientId,
    clientId,
    async get() {
      if (!clientId) throw notConfigured('SPOTIFY_CLIENT_ID ist nicht gesetzt.');
      if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
      const value = { clientId, clientSecret: await readSecret() };
      cached = { value, at: Date.now() };
      return value;
    },
  };
}

/** Fixed credentials, for tests and the offline demo. */
export function staticCredentials(clientId: string, clientSecret: string): SpotifyCredentialsProvider {
  return { configured: true, clientId, get: async () => ({ clientId, clientSecret }) };
}
