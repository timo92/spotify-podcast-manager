#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { CertificateStack } from '../lib/certificate-stack.js';
import { assertSpotifyConfigured, resolveConfig } from '../lib/config.js';
import { PodcastStack } from '../lib/podcast-stack.js';

/**
 * Configuration: environment variables (CI, or the repository's `.env` file,
 * see .env.example – loaded by the `app` command in cdk.json) or CDK context
 * (`cdk.json` / `-c key=value`):
 *
 *   SPOTIFY_CLIENT_ID   spotifyClientId   your Spotify app's client ID
 *   DOMAIN_NAME         domainName        podcasts.example.com (optional)
 *   HOSTED_ZONE_NAME    hostedZoneName    example.com (optional)
 *   CERTIFICATE_ARN     certificateArn    us-east-1 certificate (optional)
 *   STACK_NAME          stackName         PodcastCockpit
 *
 * The client secret never goes through CDK: the stack creates its parameter
 * with a placeholder, and you set the value after deploying
 * (`pnpm run secret:put`).
 */
const app = new App();
const config = resolveConfig((key) => app.node.tryGetContext(key));
assertSpotifyConfigured(config);

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? 'eu-central-1';

const frontendDir = join(import.meta.dirname, '../../frontend/dist');
if (!existsSync(join(frontendDir, 'index.html'))) {
  throw new Error('Frontend is not built yet. Run "pnpm build" in the repository root first (or use "pnpm run deploy").');
}

let certStack: CertificateStack | undefined;
if (config.domainName && !config.certificateArn && config.hostedZoneName) {
  certStack = new CertificateStack(app, `${config.stackName}Certificate`, {
    env: { account, region: 'us-east-1' },
    crossRegionReferences: true,
    domainName: config.domainName,
    hostedZoneName: config.hostedZoneName,
  });
}

const main = new PodcastStack(app, config.stackName, {
  env: { account, region },
  crossRegionReferences: !!certStack,
  domainName: config.domainName,
  hostedZoneName: config.hostedZoneName,
  certificate: certStack?.certificate,
  certificateArn: config.certificateArn,
  spotifyClientId: config.spotifyClientId,
  frontendDir,
  description: 'Personal podcast cockpit in front of Spotify',
});
if (certStack) main.addDependency(certStack);
