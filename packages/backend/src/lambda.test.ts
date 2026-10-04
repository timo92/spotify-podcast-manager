import { gunzipSync } from 'node:zlib';
import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import dynalite from 'dynalite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DynamoStore } from './store/dynamo.js';

let server: ReturnType<typeof dynalite>;
let handler: typeof import('./lambda.js').handler;
let store: DynamoStore;

beforeAll(async () => {
  server = dynalite({ createTableMs: 0 });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  Object.assign(process.env, {
    AWS_ENDPOINT_URL_DYNAMODB: endpoint,
    AWS_REGION: 'local',
    AWS_ACCESS_KEY_ID: 'x',
    AWS_SECRET_ACCESS_KEY: 'x',
    TABLE_NAME: 'lambda-test',
    SETUP_CODE: 'code',
  });
  const client = new DynamoDBClient({});
  await client.send(
    new CreateTableCommand({
      TableName: 'lambda-test',
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    }),
  );
  store = new DynamoStore('lambda-test', client);
  ({ handler } = await import('./lambda.js'));
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function event(method: string, path: string, extra: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: { 'x-public-host': 'podcasts.example.com', 'content-type': 'application/json', ...extra.headers },
    requestContext: { http: { method } } as APIGatewayProxyEventV2['requestContext'],
    isBase64Encoded: false,
    ...extra,
  } as APIGatewayProxyEventV2;
}

describe('lambda handler', () => {
  it('serves the status with the public redirect URI', async () => {
    const res = await handler(event('GET', '/api/status'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body).toMatchObject({
      configured: false,
      setupCodeRequired: true,
      redirectUri: 'https://podcasts.example.com/api/auth/callback',
    });
    expect(res.headers?.['Cache-Control']).toBe('no-store');
  });

  it('rejects unauthenticated API calls and wrong setup codes', async () => {
    expect((await handler(event('GET', '/api/today'))).statusCode).toBe(401);
    const res = await handler(event('POST', '/api/setup', { body: JSON.stringify({ setupCode: 'nope' }) }));
    expect(res.statusCode).toBe(403);
  });

  it('reads the session cookie and gzips large responses', async () => {
    await store.putSession({ id: 'sess', createdAt: 'c', expiresAt: Math.floor(Date.now() / 1000) + 600 });
    for (let i = 0; i < 20; i++) {
      await store.putShow({
        id: `show${i}`,
        source: 'spotify',
        name: `Show ${i}`,
        description: 'Lorem ipsum '.repeat(40),
        spotifyUrl: 'u',
        mode: 'SEQUENTIAL',
        categories: [],
        paused: false,
        hiddenFromToday: false,
        priority: i,
        reofferSkipped: false,
        needsReview: false,
        followed: true,
        createdAt: 'c',
        updatedAt: 'u',
      });
    }
    const res = await handler(
      event('GET', '/api/shows', { cookies: ['pm_session=sess'], headers: { 'accept-encoding': 'gzip, br' } }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.isBase64Encoded).toBe(true);
    expect(res.headers?.['Content-Encoding']).toBe('gzip');
    const shows = JSON.parse(gunzipSync(Buffer.from(res.body!, 'base64')).toString('utf8'));
    expect(shows).toHaveLength(20);
  });

  it('sets cookies through the v2 cookies field', async () => {
    const res = await handler(event('POST', '/api/auth/logout', { cookies: ['pm_session=sess'], body: '{}' }));
    expect(res.cookies?.[0]).toMatch(/^pm_session=; .*Max-Age=0; Secure/);
    expect(await store.getSession('sess')).toBeUndefined();
  });

  it('returns 400 for invalid JSON', async () => {
    expect((await handler(event('POST', '/api/sync', { body: '{nope' }))).statusCode).toBe(400);
  });
});
