import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPO_ROOT = join(import.meta.dirname, '../../..');
export const DEFAULT_SECRET_PARAMETER = '/podcast-cockpit/spotify-client-secret';

/**
 * Deployment configuration. Each value comes from an environment variable
 * (CI, or the repository's `.env` file) or from CDK context (`cdk.json` /
 * `-c key=value`); the environment wins.
 */
export interface DeployConfig {
  /** Client ID of your Spotify developer app (not a secret). */
  spotifyClientId?: string;
  /** SSM SecureString holding the Spotify client secret. */
  spotifyClientSecretParameter: string;
  domainName?: string;
  hostedZoneName?: string;
  certificateArn?: string;
  stackName: string;
}

const SETTINGS: [keyof DeployConfig, string][] = [
  ['spotifyClientId', 'SPOTIFY_CLIENT_ID'],
  ['spotifyClientSecretParameter', 'SPOTIFY_CLIENT_SECRET_PARAMETER'],
  ['domainName', 'DOMAIN_NAME'],
  ['hostedZoneName', 'HOSTED_ZONE_NAME'],
  ['certificateArn', 'CERTIFICATE_ARN'],
  ['stackName', 'STACK_NAME'],
];

/** Loads `<repo>/.env` into process.env if it exists (variables already set win). */
export function loadDotEnv(): void {
  const file = join(REPO_ROOT, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

/** Context values from cdk.json, for scripts that run outside of `cdk`. */
export function cdkJsonContext(): (key: string) => unknown {
  const file = join(import.meta.dirname, '../cdk.json');
  const context = (JSON.parse(readFileSync(file, 'utf8')) as { context?: Record<string, unknown> }).context ?? {};
  return (key) => context[key];
}

export function resolveConfig(context: (key: string) => unknown, env: NodeJS.ProcessEnv = process.env): DeployConfig {
  const value = (key: string, envName: string): string | undefined => {
    for (const v of [env[envName], context(key)]) if (typeof v === 'string' && v.trim()) return v.trim();
    return undefined;
  };
  const raw = Object.fromEntries(SETTINGS.map(([key, envName]) => [key, value(key, envName)])) as Partial<DeployConfig>;
  const { domainName, certificateArn } = raw;
  return {
    ...raw,
    spotifyClientSecretParameter: raw.spotifyClientSecretParameter ?? DEFAULT_SECRET_PARAMETER,
    // With certificateArn, DNS records are only created if hostedZoneName is set explicitly.
    hostedZoneName:
      raw.hostedZoneName ?? (domainName && !certificateArn ? domainName.split('.').slice(1).join('.') : undefined),
    stackName: raw.stackName ?? 'PodcastCockpit',
  };
}

/** Throws with instructions when the deployment would not be able to talk to Spotify. */
export function assertSpotifyConfigured(config: DeployConfig): asserts config is DeployConfig & { spotifyClientId: string } {
  if (!config.spotifyClientId) {
    throw new Error(
      'SPOTIFY_CLIENT_ID is not set. Put the client ID of your Spotify app into .env (see .env.example), ' +
        'a CI variable, or "spotifyClientId" in packages/infra/cdk.json.',
    );
  }
}
