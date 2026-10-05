/**
 * Pre-deploy check (part of `pnpm run deploy`): fails before anything is
 * deployed if the Spotify configuration is incomplete, instead of at the
 * first login.
 *
 *   - SPOTIFY_CLIENT_ID must be set (environment, .env or cdk.json)
 *   - the SecureString parameter with the client secret must exist in the
 *     region you deploy to (create it with `pnpm run secret:put`)
 */
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { assertSpotifyConfigured, cdkJsonContext, loadDotEnv, resolveConfig } from '../lib/config.js';

loadDotEnv();
const config = resolveConfig(cdkJsonContext());
try {
  assertSpotifyConfigured(config);
} catch (e) {
  console.error(`✖ ${(e as Error).message}`);
  process.exit(1);
}

const ssm = new SSMClient({});
const region = await ssm.config.region();
const name = config.spotifyClientSecretParameter;
try {
  // Existence check only – no decryption, so the secret value is never read here.
  await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: false }));
} catch (e) {
  if ((e as { name?: string }).name === 'ParameterNotFound') {
    console.error(
      `✖ The Spotify client secret is missing: SSM parameter ${name} does not exist in ${region}.\n` +
        '  Store it with `pnpm run secret:put` (reads SPOTIFY_CLIENT_SECRET from .env or the environment).',
    );
    process.exit(1);
  }
  throw e;
}
console.log(`✔ Spotify configuration complete (client ID set, secret in ${name}, ${region}).`);
