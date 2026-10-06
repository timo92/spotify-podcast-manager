import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Deployment configuration. Each value comes from an environment variable
 * (CI, or the repository's `.env` file, which the package scripts load with
 * Node's --env-file-if-exists) or from CDK context (`cdk.json` /
 * `-c key=value`); the environment wins.
 *
 * The Spotify client secret is deliberately not part of it: the stack creates
 * its parameter, and the value is set after deploying (`pnpm run secret:put`).
 */
export interface DeployConfig {
  /** Client ID of your Spotify developer app (not a secret). */
  spotifyClientId?: string;
  domainName?: string;
  hostedZoneName?: string;
  certificateArn?: string;
  /** Name prefix of the stacks and the SSM path (STACK_NAME, default PodcastCockpit). */
  appName: string;
  /** Deployment stage, e.g. dev or prod (STAGE, default dev). */
  stage: string;
  /** `<appName>-<stage>`; the certificate stack is `<stackName>-Certificate`. */
  stackName: string;
}

type Setting = 'spotifyClientId' | 'domainName' | 'hostedZoneName' | 'certificateArn' | 'appName' | 'stage';

const SETTINGS: [Setting, string, string][] = [
  // [field, environment variable, CDK context key]
  ['spotifyClientId', 'SPOTIFY_CLIENT_ID', 'spotifyClientId'],
  ['domainName', 'DOMAIN_NAME', 'domainName'],
  ['hostedZoneName', 'HOSTED_ZONE_NAME', 'hostedZoneName'],
  ['certificateArn', 'CERTIFICATE_ARN', 'certificateArn'],
  ['appName', 'STACK_NAME', 'stackName'],
  ['stage', 'STAGE', 'stage'],
];

/** Tags put on every resource of both stacks (also usable as cost allocation tags). */
export function resourceTags(config: Pick<DeployConfig, 'stage'>): Record<string, string> {
  return { app: 'podcast-cockpit', stage: config.stage, 'managed-by': 'cdk' };
}

/**
 * Context values for scripts that run outside of `cdk`: cdk.json, overridden by
 * `-c key=value` / `--context key=value` arguments like the cdk CLI accepts, so
 * e.g. `-c stage=prod` selects the same stack in both.
 */
export function scriptContext(argv: string[] = process.argv.slice(2)): (key: string) => unknown {
  const file = join(import.meta.dirname, '../cdk.json');
  const context = (JSON.parse(readFileSync(file, 'utf8')) as { context?: Record<string, unknown> }).context ?? {};
  const args = contextFromArgs(argv);
  return (key) => (key in args ? args[key] : context[key]);
}

export function contextFromArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) break;
    let pair: string | undefined;
    if (arg === '-c' || arg === '--context') pair = argv[++i];
    else if (arg.startsWith('--context=')) pair = arg.slice('--context='.length);
    if (pair === undefined) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new Error(`Invalid context argument "${pair}", expected key=value.`);
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

export function resolveConfig(context: (key: string) => unknown, env: NodeJS.ProcessEnv = process.env): DeployConfig {
  const value = (key: string, envName: string): string | undefined => {
    for (const v of [env[envName], context(key)]) if (typeof v === 'string' && v.trim()) return v.trim();
    return undefined;
  };
  const raw = Object.fromEntries(
    SETTINGS.map(([field, envName, contextKey]) => [field, value(contextKey, envName)]),
  ) as Partial<Record<Setting, string>>;
  const { domainName, certificateArn } = raw;
  const appName = raw.appName ?? 'PodcastCockpit';
  const stage = raw.stage ?? 'dev';
  // Part of stack names and an SSM path segment, so keep it simple.
  if (!/^[a-z][a-z0-9-]{0,19}$/.test(stage)) {
    throw new Error(`STAGE "${stage}" is invalid: use lower-case letters, digits and "-" (e.g. dev, prod).`);
  }
  return {
    ...raw,
    // With certificateArn, DNS records are only created if hostedZoneName is set explicitly.
    hostedZoneName:
      raw.hostedZoneName ?? (domainName && !certificateArn ? domainName.split('.').slice(1).join('.') : undefined),
    appName,
    stage,
    stackName: `${appName}-${stage}`,
  };
}

/** Throws with instructions when the deployment would not be able to talk to Spotify. */
export function assertSpotifyConfigured(
  config: DeployConfig,
): asserts config is DeployConfig & { spotifyClientId: string } {
  if (!config.spotifyClientId) {
    throw new Error(
      'SPOTIFY_CLIENT_ID is not set. Put the client ID of your Spotify app into .env (see .env.example), ' +
        'a CI variable, or "spotifyClientId" in packages/infra/cdk.json.',
    );
  }
}
