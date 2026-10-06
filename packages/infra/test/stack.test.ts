import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App, Tags } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ORIGIN_VERIFY_HEADER, SPOTIFY_CLIENT_SECRET_PLACEHOLDER } from '@podcast/shared';
import { resourceTags } from '../lib/config.js';
import { CONTENT_SECURITY_POLICY, PERMISSIONS_POLICY, PodcastStack } from '../lib/podcast-stack.js';

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
    appName: 'PodcastCockpit',
    stage: 'test',
    frontendDir: fakeFrontend(),
    ...props,
  });
  // as in bin/app.ts
  for (const [key, value] of Object.entries(resourceTags({ stage: 'test' }))) Tags.of(app).add(key, value);
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

  it('keeps point-in-time recovery for the table', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      Replicas: [Match.objectLike({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } })],
    });
  });

  it('keeps the site bucket private and reachable over TLS only', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        ]),
      },
    });
  });

  it('throttles the API and sends security headers with a CSP on the site and the API', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 },
    });
    template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          StrictTransportSecurity: Match.objectLike({ AccessControlMaxAgeSec: 31_536_000 }),
          ContentTypeOptions: Match.anyValue(),
          FrameOptions: Match.objectLike({ FrameOption: 'SAMEORIGIN' }),
          ReferrerPolicy: Match.objectLike({ ReferrerPolicy: 'strict-origin-when-cross-origin' }),
          // enforced, not only reported
          ContentSecurityPolicy: { ContentSecurityPolicy: CONTENT_SECURITY_POLICY, Override: true },
        }),
        CustomHeadersConfig: {
          Items: [{ Header: 'Permissions-Policy', Value: PERMISSIONS_POLICY, Override: true }],
        },
      }),
    });
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self' https://sdk.scdn.co");
    const policy = { Ref: Match.stringLikeRegexp('^SecurityHeaders') };
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ResponseHeadersPolicyId: policy }),
        CacheBehaviors: [Match.objectLike({ ResponseHeadersPolicyId: policy })],
      }),
    });
  });

  it('lets the API be reached only through CloudFront', () => {
    // The stack's UUID, from its ID: arn:aws:cloudformation:<region>:<account>:stack/<name>/<uuid>
    const stackUuid = { 'Fn::Select': [2, { 'Fn::Split': ['/', { Ref: 'AWS::StackId' }] }] };
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Origins: Match.arrayWith([
          Match.objectLike({
            CustomOriginConfig: Match.objectLike({ OriginProtocolPolicy: 'https-only' }),
            OriginCustomHeaders: [{ HeaderName: ORIGIN_VERIFY_HEADER, HeaderValue: stackUuid }],
          }),
        ]),
      }),
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Environment: { Variables: Match.objectLike({ ORIGIN_SECRET: stackUuid }) },
    });
  });

  it('syncs every two hours and fully once a night', () => {
    template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'cron(7 */2 * * ? *)' });
    template.hasResourceProperties('AWS::Events::Rule', { ScheduleExpression: 'cron(37 3 * * ? *)' });
  });

  it("keeps the functions' logs for a month", () => {
    const groups = Object.values(template.findResources('AWS::Logs::LogGroup'));
    expect(groups.length).toBeGreaterThanOrEqual(3);
    for (const group of groups) expect(group.Properties.RetentionInDays).toBe(30);
    // Every function, CDK's deployment helpers included, logs into one of them –
    // except the bucket's auto-delete handler, which CDK offers no setting for.
    const functions = template.findResources('AWS::Lambda::Function');
    const withoutGroup = Object.keys(functions).filter((id) => !functions[id]?.Properties.LoggingConfig?.LogGroup);
    expect(withoutGroup).toEqual([expect.stringMatching(/^CustomS3AutoDeleteObjects/)]);
  });

  it('wires the API and sync Lambdas', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: 'nodejs22.x',
      Environment: {
        Variables: Match.objectLike({
          SPOTIFY_CLIENT_ID: 'client-id',
          SPOTIFY_CLIENT_SECRET_PARAMETER: '/PodcastCockpit/test/spotify-client-secret',
          SYNC_FUNCTION_NAME: Match.anyValue(),
        }),
      },
    });
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.syncHandler',
      Timeout: 900,
    });
    // Reserving concurrency fails in accounts with the minimum quota of 10.
    for (const fn of Object.values(template.findResources('AWS::Lambda::Function'))) {
      expect(fn.Properties.ReservedConcurrentExecutions).toBeUndefined();
    }
    template.resourceCountIs('AWS::Events::Rule', 2);
  });

  it('creates the client-secret parameter with a placeholder and lets both functions read it', () => {
    const resources = template.findResources('Custom::AWS');
    const create = JSON.stringify(Object.values(resources)[0]);
    expect(create).toContain('SecureString');
    expect(create).toContain(SPOTIFY_CLIENT_SECRET_PLACEHOLDER);
    expect(create).toContain('/PodcastCockpit/test/spotify-client-secret');
    // CloudFormation never manages the value itself.
    template.resourceCountIs('AWS::SSM::Parameter', 0);
    // Stack tags don't reach a resource created by an SDK call, so it is tagged there.
    const call = JSON.parse(Object.values(resources)[0]!.Properties.Create) as { parameters: { Tags: unknown } };
    expect(call.parameters.Tags).toEqual([
      { Key: 'app', Value: 'podcast-cockpit' },
      { Key: 'stage', Value: 'test' },
      { Key: 'managed-by', Value: 'cdk' },
    ]);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: Match.arrayWith(['ssm:AddTagsToResource']) })]),
      },
    });
    const reads = Object.values(template.findResources('AWS::IAM::Policy')).filter((p) => {
      const json = JSON.stringify(p);
      return json.includes(':parameter/PodcastCockpit/test/spotify-client-secret') && json.includes('ssm:GetParameter');
    });
    expect(reads).toHaveLength(2);
  });

  it('tags resources with app, stage and managed-by', () => {
    const expected = [
      { Key: 'app', Value: 'podcast-cockpit' },
      { Key: 'managed-by', Value: 'cdk' },
      { Key: 'stage', Value: 'test' },
    ];
    template.hasResourceProperties('AWS::Lambda::Function', { Tags: Match.arrayWith(expected) });
    template.hasResourceProperties('AWS::S3::Bucket', { Tags: Match.arrayWith(expected) });
    template.hasResourceProperties('AWS::CloudFront::Distribution', { Tags: Match.arrayWith(expected) });
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      Replicas: [Match.objectLike({ Tags: Match.arrayWith(expected) })],
    });
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
