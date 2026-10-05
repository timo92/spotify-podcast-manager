import { describe, expect, it } from 'vitest';
import { assertSpotifyConfigured, contextFromArgs, resolveConfig, scriptContext } from '../lib/config.js';

describe('resolveConfig', () => {
  it('prefers environment variables over CDK context', () => {
    const context: Record<string, string> = { spotifyClientId: 'from-context', domainName: 'podcasts.example.com' };
    const config = resolveConfig((k) => context[k], { SPOTIFY_CLIENT_ID: 'from-env' });
    expect(config).toMatchObject({
      spotifyClientId: 'from-env',
      domainName: 'podcasts.example.com',
      hostedZoneName: 'example.com',
      appName: 'PodcastCockpit',
      stage: 'dev',
      stackName: 'PodcastCockpit-dev',
    });
  });

  it('ignores empty values and only derives the hosted zone without a certificate ARN', () => {
    const config = resolveConfig(() => '', { DOMAIN_NAME: 'a.example.com', CERTIFICATE_ARN: 'arn:x' });
    expect(config.spotifyClientId).toBeUndefined();
    expect(config.hostedZoneName).toBeUndefined();
  });
});

describe('assertSpotifyConfigured', () => {
  it('fails without a client ID and passes with one', () => {
    expect(() => assertSpotifyConfigured(resolveConfig(() => undefined, {}))).toThrow(/SPOTIFY_CLIENT_ID is not set/);
    expect(() => assertSpotifyConfigured(resolveConfig(() => undefined, { SPOTIFY_CLIENT_ID: 'id' }))).not.toThrow();
  });
});

describe('stage', () => {
  it('names the stacks after app and stage', () => {
    const config = resolveConfig((k) => (k === 'stackName' ? 'Cockpit' : undefined), { STAGE: 'prod' });
    expect(config).toMatchObject({ appName: 'Cockpit', stage: 'prod', stackName: 'Cockpit-prod' });
  });

  it('rejects stages that would break stack names or the SSM path', () => {
    for (const stage of ['Prod', 'dev/1', '-dev', 'a'.repeat(21)]) {
      expect(() => resolveConfig(() => undefined, { STAGE: stage })).toThrow(/STAGE/);
    }
  });
});

describe('contextFromArgs', () => {
  it('reads -c / --context arguments like the cdk CLI', () => {
    expect(contextFromArgs(['-c', 'stage=prod', '--context', 'stackName=X', '--context=domainName=a=b', 'other'])).toEqual({
      stage: 'prod',
      stackName: 'X',
      domainName: 'a=b',
    });
    expect(() => contextFromArgs(['-c', 'novalue'])).toThrow(/key=value/);
  });

  it('selects the same stack as cdk for a stage passed on the command line', () => {
    expect(resolveConfig(scriptContext(['-c', 'stage=prod']), {}).stackName).toBe('PodcastCockpit-prod');
  });
});
