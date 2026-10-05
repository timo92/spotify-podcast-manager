/**
 * Post-deploy step: stores the Spotify client secret in the SecureString
 * parameter the stack created (name from the stack's
 * `SpotifyClientSecretParameter` output). Run it after the first deploy and
 * again whenever you rotate the secret in the Spotify dashboard:
 *
 *   pnpm run secret:put        # reads SPOTIFY_CLIENT_SECRET from .env or the environment
 *
 * Uses your normal AWS credentials and region (AWS_PROFILE / AWS_REGION) –
 * the region the stack is deployed to.
 */
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { cdkJsonContext, resolveConfig } from '../lib/config.js';

const fail = (message: string): never => {
  console.error(`✖ ${message}`);
  process.exit(1);
};

const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim() || fail('SPOTIFY_CLIENT_SECRET is not set (environment or .env).');
const { stackName } = resolveConfig(cdkJsonContext());

const cfn = new CloudFormationClient({});
const region = await cfn.config.region();
const stacks = await cfn.send(new DescribeStacksCommand({ StackName: stackName })).catch((e: Error) =>
  fail(`Stack ${stackName} not found in ${region} – deploy first (pnpm run deploy). ${e.message}`),
);
const name =
  stacks.Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === 'SpotifyClientSecretParameter')?.OutputValue ??
  fail(`Stack ${stackName} has no SpotifyClientSecretParameter output – redeploy with the current version.`);

await new SSMClient({}).send(new PutParameterCommand({ Name: name, Value: secret, Type: 'SecureString', Overwrite: true }));
console.log(`✔ Stored the Spotify client secret in ${name} (${region}). The app picks it up within 5 minutes.`);
