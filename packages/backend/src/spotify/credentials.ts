import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { SPOTIFY_CLIENT_SECRET_PLACEHOLDER } from '@podcast/shared';
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
  readonly clientId: string | undefined;
  /** Client ID and secret, or an ApiError `not_configured` explaining what is missing. */
  get(): Promise<SpotifyCredentials>;
  /** Whether `get()` would succeed (used by the status endpoint). */
  ready(): Promise<boolean>;
}

const CACHE_MS = 5 * 60 * 1000;
/** A missing secret is re-checked sooner, so setting it takes effect quickly. */
const MISSING_CACHE_MS = 30 * 1000;

const notConfigured = (detail: string) =>
  new ApiError(StatusCodes.SERVICE_UNAVAILABLE, 'not_configured', `Spotify-Zugangsdaten fehlen: ${detail}`);

/**
 * Reads the credentials from the environment:
 *   SPOTIFY_CLIENT_ID                 the Spotify app's client ID
 *   SPOTIFY_CLIENT_SECRET             the secret itself (local development)
 *   SPOTIFY_CLIENT_SECRET_PARAMETER   name of the SSM SecureString holding the secret (AWS;
 *                                     created by the stack, set after deploying)
 * The secret is cached for a few minutes, so a changed parameter is picked up
 * without a redeploy. The stack's placeholder value counts as "not set".
 */
export function credentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  ssm: Pick<SSMClient, 'send'> = new SSMClient({}),
): SpotifyCredentialsProvider {
  const clientId = env.SPOTIFY_CLIENT_ID?.trim() || undefined;
  let cached: { value: SpotifyCredentials; at: number } | undefined;
  let missing: { error: unknown; at: number } | undefined;

  async function readSecret(): Promise<string> {
    if (env.SPOTIFY_CLIENT_SECRET?.trim()) return env.SPOTIFY_CLIENT_SECRET.trim();
    const name = env.SPOTIFY_CLIENT_SECRET_PARAMETER?.trim();
    if (!name) throw notConfigured('SPOTIFY_CLIENT_SECRET oder SPOTIFY_CLIENT_SECRET_PARAMETER ist nicht gesetzt.');
    try {
      const res = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
      const value = res.Parameter?.Value?.trim();
      if (!value || value === SPOTIFY_CLIENT_SECRET_PLACEHOLDER) {
        throw notConfigured(`Das Client-Secret in ${name} ist noch nicht gesetzt (nach dem Deploy: pnpm run secret:put).`);
      }
      return value;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if ((e as { name?: string }).name === 'ParameterNotFound') {
        throw notConfigured(`Parameter ${name} existiert nicht – ist der Stack vollständig deployt?`);
      }
      throw e;
    }
  }

  async function get(): Promise<SpotifyCredentials> {
    if (!clientId) throw notConfigured('SPOTIFY_CLIENT_ID ist nicht gesetzt.');
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
    if (missing && Date.now() - missing.at < MISSING_CACHE_MS) throw missing.error;
    try {
      const value = { clientId, clientSecret: await readSecret() };
      cached = { value, at: Date.now() };
      missing = undefined;
      return value;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_configured') missing = { error: e, at: Date.now() };
      throw e;
    }
  }

  return {
    clientId,
    get,
    async ready() {
      try {
        await get();
        return true;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'not_configured') return false;
        throw e;
      }
    },
  };
}

/** Fixed credentials, for tests and the offline demo. */
export function staticCredentials(clientId: string, clientSecret: string): SpotifyCredentialsProvider {
  return { clientId, get: async () => ({ clientId, clientSecret }), ready: async () => true };
}
