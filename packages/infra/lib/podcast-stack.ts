import { join } from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat, type NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as cr from 'aws-cdk-lib/custom-resources';
import { SPOTIFY_CLIENT_SECRET_PLACEHOLDER } from '@podcast/shared';
import { resourceTags } from './config.js';
import type { Construct } from 'constructs';

const ROOT = join(import.meta.dirname, '../../..');

export interface PodcastStackProps extends StackProps {
  /** e.g. podcasts.example.com – optional, the CloudFront domain works too. */
  domainName?: string;
  /** Route 53 zone for DNS records (e.g. example.com). Skip if DNS is elsewhere. */
  hostedZoneName?: string;
  /** Certificate in us-east-1 covering `domainName`. */
  certificate?: acm.ICertificate;
  /** Alternative to `certificate`: ARN of an existing us-east-1 certificate. */
  certificateArn?: string;
  /** Client ID of the Spotify developer app. */
  spotifyClientId: string;
  /** Name prefix, also the first segment of the SSM path (e.g. PodcastCockpit). */
  appName: string;
  /** Deployment stage, the second SSM path segment (e.g. dev). */
  stage: string;
  /** Built frontend (packages/frontend/dist). */
  frontendDir?: string;
}

/**
 * Everything the podcast cockpit needs, behind one CloudFront distribution:
 *
 *   https://<domain>/          → S3 (SPA, CloudFront function rewrites to index.html)
 *   https://<domain>/api/*     → API Gateway (HTTP API) → Lambda "api"
 *   EventBridge (every 2 h)    → Lambda "sync" (also invoked async by the API)
 *   DynamoDB single table      ← both Lambdas
 *
 * Serving the API on the same origin keeps the session cookie first-party and
 * avoids CORS entirely.
 */
export class PodcastStack extends Stack {
  constructor(scope: Construct, id: string, props: PodcastStackProps) {
    super(scope, id, props);

    const certificate =
      props.certificate ??
      (props.certificateArn
        ? acm.Certificate.fromCertificateArn(this, 'Certificate', props.certificateArn)
        : undefined);
    if (props.domainName && !certificate) {
      throw new Error('domainName needs either a Route 53 hosted zone or a certificateArn');
    }

    // ------------------------------------------------------------ storage

    const table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      globalSecondaryIndexes: [
        {
          indexName: 'GSI1',
          partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
        },
      ],
      // Holds your listening progress – keep it if the stack is deleted.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Logs of CDK's helper functions (parameter creation, site deployment);
    // without a group of their own they would be kept forever.
    const helperLogs = new logs.LogGroup(this, 'DeploymentHelperLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ------------------------------------------------------ spotify secret

    // CloudFormation cannot create SecureString parameters, so a custom resource
    // creates it once with a placeholder. The real value is set after deploying
    // (`pnpm run secret:put` or the console) and is never part of a template.
    // Later deployments don't touch it; deleting the stack deletes it.
    const clientSecretParameter = `/${props.appName}/${props.stage}/spotify-client-secret`;
    const clientSecretArn = this.formatArn({
      service: 'ssm',
      resource: 'parameter',
      resourceName: clientSecretParameter.slice(1),
    });
    new cr.AwsCustomResource(this, 'SpotifyClientSecret', {
      onCreate: {
        service: 'SSM',
        action: 'putParameter',
        parameters: {
          Name: clientSecretParameter,
          Type: 'SecureString',
          Value: SPOTIFY_CLIENT_SECRET_PLACEHOLDER,
          Description: 'Client secret of the Spotify developer app (set it with `pnpm run secret:put`)',
          // Stack tags don't reach a resource created by an SDK call.
          Tags: Object.entries(resourceTags(props)).map(([Key, Value]) => ({ Key, Value })),
        },
        physicalResourceId: cr.PhysicalResourceId.of(clientSecretParameter),
        // Keep an existing value, e.g. when the stack is recreated.
        ignoreErrorCodesMatching: 'ParameterAlreadyExists',
      },
      onDelete: {
        service: 'SSM',
        action: 'deleteParameter',
        parameters: { Name: clientSecretParameter },
        ignoreErrorCodesMatching: 'ParameterNotFound',
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          // Creating a parameter with tags also needs the tagging permission.
          actions: ['ssm:PutParameter', 'ssm:AddTagsToResource', 'ssm:DeleteParameter'],
          resources: [clientSecretArn],
        }),
      ]),
      installLatestAwsSdk: false,
      logGroup: helperLogs,
    });

    // ------------------------------------------------------------ lambdas

    const common = {
      entry: join(ROOT, 'packages/backend/src/lambda.ts'),
      projectRoot: ROOT,
      depsLockFilePath: join(ROOT, 'pnpm-lock.yaml'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        sourceMap: true,
        minify: true,
        // The Node.js 22 runtime ships AWS SDK v3.
        externalModules: ['@aws-sdk/*'],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
      environment: {
        TABLE_NAME: table.tableName,
        SPOTIFY_CLIENT_ID: props.spotifyClientId,
        SPOTIFY_CLIENT_SECRET_PARAMETER: clientSecretParameter,
        NODE_OPTIONS: '--enable-source-maps',
      },
    } satisfies Partial<NodejsFunctionProps>;

    const syncFn = new NodejsFunction(this, 'SyncFunction', {
      ...common,
      handler: 'syncHandler',
      memorySize: 512,
      timeout: Duration.minutes(15),
      // No reserved concurrency: new accounts may only have 10 concurrent
      // executions, all of which must stay unreserved. A lease in DynamoDB keeps
      // syncs from running in parallel instead (backend services/sync.ts).
      logGroup: new logs.LogGroup(this, 'SyncLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      description: 'Imports shows and episodes from Spotify',
    });
    table.grantReadWriteData(syncFn);

    const apiFn = new NodejsFunction(this, 'ApiFunction', {
      ...common,
      handler: 'handler',
      memorySize: 512,
      timeout: Duration.seconds(29),
      environment: {
        ...common.environment,
        SYNC_FUNCTION_NAME: syncFn.functionName,
        PUBLIC_URL: props.domainName ? `https://${props.domainName}` : '',
      },
      logGroup: new logs.LogGroup(this, 'ApiLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      description: 'Podcast cockpit API',
    });
    table.grantReadWriteData(apiFn);
    syncFn.grantInvoke(apiFn);

    // Both functions read the secret at runtime.
    const clientSecret = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'SpotifyClientSecretRef', {
      parameterName: clientSecretParameter,
    });
    clientSecret.grantRead(apiFn);
    clientSecret.grantRead(syncFn);

    new events.Rule(this, 'IncrementalSync', {
      schedule: events.Schedule.cron({ minute: '7', hour: '*/2' }),
      targets: [
        new targets.LambdaFunction(syncFn, { event: events.RuleTargetInput.fromObject({ source: 'schedule' }) }),
      ],
      description: 'Fetch new episodes from Spotify',
    });
    new events.Rule(this, 'FullSync', {
      schedule: events.Schedule.cron({ minute: '37', hour: '3' }),
      targets: [
        new targets.LambdaFunction(syncFn, {
          event: events.RuleTargetInput.fromObject({ source: 'schedule', full: true }),
        }),
      ],
      description: 'Daily full refresh (metadata, Spotify resume points of older episodes)',
    });

    // ---------------------------------------------------------------- api

    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      description: 'Podcast cockpit API (reached through CloudFront)',
      defaultIntegration: new HttpLambdaIntegration('ApiIntegration', apiFn),
      createDefaultStage: true,
    });
    // Modest throttling – this is a single-user app.
    const stage = httpApi.defaultStage?.node.defaultChild;
    if (!(stage instanceof apigw.CfnStage)) throw new Error('HTTP API has no default stage');
    stage.defaultRouteSettings = { throttlingRateLimit: 20, throttlingBurstLimit: 40 };

    // ----------------------------------------------------------- frontend

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const spaRewrite = new cloudfront.Function(this, 'SpaRewrite', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Serve index.html for client-side routes',
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var last = request.uri.split('/').pop();
  if (last.indexOf('.') === -1) request.uri = '/index.html';
  return request;
}`),
    });

    const forwardHost = new cloudfront.Function(this, 'ForwardHost', {
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Tell the API under which host it is reached (OAuth redirect URI)',
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  request.headers['x-public-host'] = { value: request.headers.host.value };
  return request;
}`),
    });

    const apiDomain = `${httpApi.apiId}.execute-api.${this.region}.amazonaws.com`;

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'Podcast cockpit',
      domainNames: props.domainName ? [props.domainName] : undefined,
      certificate: props.domainName ? certificate : undefined,
      defaultRootObject: 'index.html',
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      minimumProtocolVersion: props.domainName ? cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021 : undefined,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
        functionAssociations: [{ function: spaRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(apiDomain, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          functionAssociations: [{ function: forwardHost, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        },
      },
    });

    const frontendDir = props.frontendDir ?? join(ROOT, 'packages/frontend/dist');
    // Hashed assets can be cached forever; everything else must revalidate.
    new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [s3deploy.Source.asset(join(frontendDir, 'assets'))],
      destinationBucket: bucket,
      destinationKeyPrefix: 'assets',
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
      prune: false,
      memoryLimit: 512,
      logGroup: helperLogs,
    });
    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(frontendDir, { exclude: ['assets/*'] })],
      destinationBucket: bucket,
      cacheControl: [s3deploy.CacheControl.fromString('no-cache')],
      prune: false,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
      logGroup: helperLogs,
    });

    // ---------------------------------------------------------------- dns

    if (props.domainName && props.hostedZoneName) {
      const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: props.hostedZoneName });
      const target = route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(distribution));
      new route53.ARecord(this, 'AliasA', { zone, recordName: props.domainName, target });
      new route53.AaaaRecord(this, 'AliasAAAA', { zone, recordName: props.domainName, target });
    }

    // ------------------------------------------------------------ outputs

    const url = props.domainName ? `https://${props.domainName}` : `https://${distribution.distributionDomainName}`;
    new CfnOutput(this, 'Url', { value: url, description: 'Open this URL to set up the app' });
    new CfnOutput(this, 'SpotifyRedirectUri', {
      value: `${url}/api/auth/callback`,
      description: 'Register this redirect URI in your Spotify app',
    });
    new CfnOutput(this, 'SpotifyClientSecretParameter', {
      value: clientSecretParameter,
      description: 'SSM SecureString for the Spotify client secret – set it after deploying (pnpm run secret:put)',
    });
    new CfnOutput(this, 'DistributionDomain', {
      value: distribution.distributionDomainName,
      description: 'CNAME target if your DNS is not in Route 53',
    });
    new CfnOutput(this, 'TableName', { value: table.tableName });
  }
}
