#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { App, Tags } from 'aws-cdk-lib';
import { CertificateStack } from '../lib/certificate-stack.js';
import { assertSpotifyConfigured, resolveConfig, resourceTags } from '../lib/config.js';
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
 *   STAGE               stage             dev (part of the stack names and SSM path)
 *   STACK_NAME          stackName         PodcastCockpit (prefix; stacks are <prefix>-<stage>)
 *
 * The client secret never goes through CDK: the stack creates its parameter
 * with a placeholder, and you set the value after deploying
 * (`pnpm run secret:put`).
 */
const app = new App();
const config = resolveConfig((key) => app.node.tryGetContext(key));
assertSpotifyConfigured(config);

// Set by the CDK CLI from the active AWS credentials (AWS_PROFILE or --profile).
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? 'eu-central-1';

// The Route 53 lookup needs a concrete account; without credentials CDK only
// fails with a cryptic "context provider hosted-zone" error.
if (config.hostedZoneName && !account) {
  throw new Error(
    'No AWS account: the CDK CLI found no usable AWS credentials, but looking up the hosted zone ' +
      `"${config.hostedZoneName}" needs one. Set AWS_PROFILE=<name> in .env (or in your shell), ` +
      'log in with `aws sso login --profile <name>`, and run cdk through the package scripts ' +
      '(`pnpm run deploy`), which load .env.',
  );
}

const frontendDir = join(import.meta.dirname, '../../frontend/dist');
if (!existsSync(join(frontendDir, 'index.html'))) {
  throw new Error('Frontend is not built yet. Run "pnpm build" in the repository root first (or use "pnpm run deploy").');
}

let certStack: CertificateStack | undefined;
if (config.domainName && !config.certificateArn && config.hostedZoneName) {
  certStack = new CertificateStack(app, `${config.stackName}-Certificate`, {
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
  appName: config.appName,
  stage: config.stage,
  frontendDir,
  description: 'Personal podcast cockpit in front of Spotify',
});
if (certStack) main.addStackDependency(certStack);

// app, stage and managed-by on every resource of both stacks.
for (const [key, value] of Object.entries(resourceTags(config))) Tags.of(app).add(key, value);
