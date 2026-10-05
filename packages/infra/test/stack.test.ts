import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { PodcastStack } from '../lib/podcast-stack.js';

function fakeFrontend() {
  const dir = mkdtempSync(join(tmpdir(), 'frontend-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  writeFileSync(join(dir, 'assets', 'app.js'), '');
  return dir;
}

function synth(props: Partial<ConstructorParameters<typeof PodcastStack>[2]> = {}) {
  const app = new App();
  const stack = new PodcastStack(app, 'Test', {
    env: { account: '123456789012', region: 'eu-central-1' },
    spotifyClientId: 'client-id',
    spotifyClientSecretParameter: '/podcast-cockpit/spotify-client-secret',
    frontendDir: fakeFrontend(),
    ...props,
  });
  return Template.fromStack(stack);
}

describe('PodcastStack', () => {
  const template = synth();

  it('creates the single table with history index and TTL', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      GlobalSecondaryIndexes: [Match.objectLike({ IndexName: 'GSI1' })],
    });
    template.hasResource('AWS::DynamoDB::GlobalTable', { DeletionPolicy: 'Retain' });
  });

  it('wires the API and sync Lambdas', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: 'nodejs22.x',
      Environment: {
        Variables: Match.objectLike({
          SPOTIFY_CLIENT_ID: 'client-id',
          SPOTIFY_CLIENT_SECRET_PARAMETER: '/podcast-cockpit/spotify-client-secret',
          SYNC_FUNCTION_NAME: Match.anyValue(),
        }),
      },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.syncHandler',
      ReservedConcurrentExecutions: 1,
      Timeout: 900,
    });
    template.resourceCountIs('AWS::Events::Rule', 2);
  });

  it('lets both functions read the client secret parameter, without its value in the template', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const reads = Object.values(policies).filter((p) =>
      JSON.stringify(p).includes(':parameter/podcast-cockpit/spotify-client-secret'),
    );
    expect(reads).toHaveLength(2);
    // The parameter is created outside of CloudFormation, so no secret value is ever in a template.
    template.resourceCountIs('AWS::SSM::Parameter', 0);
  });

  it('routes /api/* through CloudFront without caching', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        CacheBehaviors: [
          Match.objectLike({
            PathPattern: '/api/*',
            CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // CachingDisabled
            AllowedMethods: Match.arrayWith(['PATCH', 'POST', 'DELETE']),
          }),
        ],
      }),
    });
  });

  it('adds the custom domain when a certificate is given', () => {
    const t = synth({
      domainName: 'podcasts.example.com',
      certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/abc',
    });
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: ['podcasts.example.com'] }),
    });
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ PUBLIC_URL: 'https://podcasts.example.com' }) },
    });
  });

  it('refuses a domain without certificate source', () => {
    expect(() => synth({ domainName: 'podcasts.example.com' })).toThrow(/certificateArn/);
  });
});
