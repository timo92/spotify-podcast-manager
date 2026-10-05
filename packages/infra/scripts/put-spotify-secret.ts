/**
 * Stores the Spotify client secret as an SSM SecureString parameter, where
 * the Lambdas read it at runtime. Run once (and again after rotating the
 * secret in the Spotify dashboard):
 *
 *   SPOTIFY_CLIENT_SECRET=… pnpm run secret:put     (or put it into .env)
 *
 * Uses your normal AWS credentials and region (AWS_PROFILE / AWS_REGION);
 * the region must be the one you deploy to.
 */
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { cdkJsonContext, loadDotEnv, resolveConfig } from '../lib/config.js';

loadDotEnv();
const { spotifyClientSecretParameter: name } = resolveConfig(cdkJsonContext());
const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
if (!secret) {
  console.error('SPOTIFY_CLIENT_SECRET is not set (environment or .env).');
  process.exit(1);
}

const ssm = new SSMClient({});
await ssm.send(
  new PutParameterCommand({
    Name: name,
    Value: secret,
    Type: 'SecureString',
    Overwrite: true,
    Description: 'Client secret of the Spotify developer app used by Podcast-Cockpit',
  }),
);
console.log(`Stored the Spotify client secret in ${name} (region ${await ssm.config.region()}).`);
