#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { CertificateStack } from '../lib/certificate-stack.js';
import { PodcastStack } from '../lib/podcast-stack.js';

/**
 * Configuration via CDK context (`-c key=value` or cdk.json):
 *
 *   domainName      podcasts.example.com            (optional)
 *   hostedZoneName  example.com                     (optional, defaults to the parent domain)
 *   certificateArn  arn:aws:acm:us-east-1:…         (optional, if DNS is not in Route 53)
 *   setupCode       any string                      (optional, generated otherwise)
 *   stackName       PodcastCockpit                  (optional)
 */
const app = new App();
const ctx = (key: string): string | undefined => {
  const v = app.node.tryGetContext(key);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
};

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = ctx('region') ?? process.env.CDK_DEFAULT_REGION ?? 'eu-central-1';
const domainName = ctx('domainName');
const certificateArn = ctx('certificateArn');
// With certificateArn, DNS records are only created if hostedZoneName is given explicitly.
const hostedZoneName =
  ctx('hostedZoneName') ?? (domainName && !certificateArn ? domainName.split('.').slice(1).join('.') : undefined);
const stackName = ctx('stackName') ?? 'PodcastCockpit';

// The setup code protects the very first setup. Generated once and kept
// locally (git-ignored) so it stays stable across deployments.
const setupCodeFile = join(import.meta.dirname, '../.setup-code');
let setupCode = ctx('setupCode');
if (!setupCode) {
  if (existsSync(setupCodeFile)) setupCode = readFileSync(setupCodeFile, 'utf8').trim();
  if (!setupCode) {
    setupCode = randomBytes(9).toString('base64url');
    writeFileSync(setupCodeFile, setupCode + '\n');
  }
}

const frontendDir = join(import.meta.dirname, '../../frontend/dist');
if (!existsSync(join(frontendDir, 'index.html'))) {
  throw new Error('Frontend is not built yet. Run "npm run build" in the repository root first (or use "npm run deploy").');
}

let certStack: CertificateStack | undefined;
if (domainName && !certificateArn && hostedZoneName) {
  certStack = new CertificateStack(app, `${stackName}Certificate`, {
    env: { account, region: 'us-east-1' },
    crossRegionReferences: true,
    domainName,
    hostedZoneName,
  });
}

const main = new PodcastStack(app, stackName, {
  env: { account, region },
  crossRegionReferences: !!certStack,
  domainName,
  hostedZoneName,
  certificate: certStack?.certificate,
  certificateArn,
  setupCode,
  frontendDir,
  description: 'Personal podcast cockpit in front of Spotify',
});
if (certStack) main.addDependency(certStack);
