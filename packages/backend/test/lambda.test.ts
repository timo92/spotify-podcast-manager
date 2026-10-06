import { gunzipSync } from 'node:zlib';
import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import dynalite from 'dynalite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DynamoStore } from '../src/store/dynamo.js';

let server: ReturnType<typeof dynalite>;
let handler: typeof import('../src/lambda.js').handler;
let syncHandler: typeof import('../src/lambda.js').syncHandler;
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
    SPOTIFY_CLIENT_ID: 'client-id',
    SPOTIFY_CLIENT_SECRET: 'secret',
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
  ({ handler, syncHandler } = await import('../src/lambda.js'));
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

type LambdaEvent = Parameters<typeof handler>[0];

interface EventInput {
  headers?: Record<string, string>;
  cookies?: string[];
  body?: string;
}

/** Minimal API Gateway HTTP API (payload v2) event, as forwarded by CloudFront. */
function event(method: string, path: string, extra: EventInput = {}): LambdaEvent {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: { 'x-public-host': 'podcasts.example.com', 'content-type': 'application/json', ...extra.headers },
    cookies: extra.cookies,
    body: extra.body ?? null,
    isBase64Encoded: false,
    requestContext: {
      domainName: 'abc.execute-api.eu-central-1.amazonaws.com',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
    },
  } as unknown as LambdaEvent;
}

/** Response header lookup, independent of casing. */
function header(res: { headers?: Record<string, unknown> }, name: string): string | undefined {
  const entry = Object.entries(res.headers ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return entry ? String(entry[1]) : undefined;
}

describe('lambda handler', () => {
  it('serves the status with the public redirect URI', async () => {
    const res = await handler(event('GET', '/api/status'));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({
      configured: true,
      claimed: false,
      redirectUri: 'https://podcasts.example.com/api/auth/callback',
    });
    expect(header(res, 'cache-control')).toBe('no-store');
  });

  it('rejects unauthenticated API calls', async () => {
    expect((await handler(event('GET', '/api/today'))).statusCode).toBe(401);
    expect((await handler(event('POST', '/api/sync', { body: '{}' }))).statusCode).toBe(401);
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
    expect(header(res, 'content-encoding')).toBe('gzip');
    const shows = JSON.parse(gunzipSync(Buffer.from(res.body, 'base64')).toString('utf8'));
    expect(shows).toHaveLength(20);
  });

  it('sets cookies through the v2 cookies field', async () => {
    const res = await handler(event('POST', '/api/auth/logout', { cookies: ['pm_session=sess'], body: '{}' }));
    expect(res.cookies?.[0]).toMatch(/^pm_session=;.*Max-Age=0/);
    expect(res.cookies?.[0]).toMatch(/Secure/);
    expect(await store.getSession('sess')).toBeUndefined();
  });

  it('frees the lease of a triggered sync when Spotify is not connected', async () => {
    const startedAt = new Date().toISOString();
    expect(await store.acquireSyncLease({ status: 'running', startedAt, leaseId: 'lease-1' }, '2000-01-01')).toBe(true);
    await syncHandler({ leaseId: 'lease-1' });
    const state = await store.getSyncState();
    expect(state.status).toBe('idle');
    expect(state.leaseId).toBeUndefined();
  });

  it('frees the lease even when retention fails while disconnected', async () => {
    const startedAt = new Date().toISOString();
    expect(await store.acquireSyncLease({ status: 'running', startedAt, leaseId: 'lease-2' }, '2000-01-01')).toBe(true);
    const failing = vi.spyOn(DynamoStore.prototype, 'listShows').mockRejectedValueOnce(new Error('throttled'));
    try {
      await expect(syncHandler({ leaseId: 'lease-2' })).rejects.toThrow('throttled');
    } finally {
      failing.mockRestore();
    }
    const state = await store.getSyncState();
    expect(state.status).toBe('idle');
    expect(state.leaseId).toBeUndefined();
  });

  it('returns 400 for invalid JSON', async () => {
    await store.putSession({ id: 'json', createdAt: 'c', expiresAt: Math.floor(Date.now() / 1000) + 600 });
    const res = await handler(event('POST', '/api/sync', { cookies: ['pm_session=json'], body: '{nope' }));
    expect(res.statusCode).toBe(400);
  });
});
