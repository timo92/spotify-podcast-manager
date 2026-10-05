import { describe, expect, it } from 'vitest';
import { DEFAULT_SECRET_PARAMETER, resolveConfig } from '../lib/config.js';

describe('resolveConfig', () => {
  it('prefers environment variables over CDK context', () => {
    const context: Record<string, string> = { spotifyClientId: 'from-context', domainName: 'podcasts.example.com' };
    const config = resolveConfig((k) => context[k], { SPOTIFY_CLIENT_ID: 'from-env' });
    expect(config).toMatchObject({
      spotifyClientId: 'from-env',
      domainName: 'podcasts.example.com',
      hostedZoneName: 'example.com',
      spotifyClientSecretParameter: DEFAULT_SECRET_PARAMETER,
      stackName: 'PodcastCockpit',
    });
  });

  it('ignores empty values and only derives the hosted zone without a certificate ARN', () => {
    const config = resolveConfig(() => '', { DOMAIN_NAME: 'a.example.com', CERTIFICATE_ARN: 'arn:x' });
    expect(config.spotifyClientId).toBeUndefined();
    expect(config.hostedZoneName).toBeUndefined();
  });
});
