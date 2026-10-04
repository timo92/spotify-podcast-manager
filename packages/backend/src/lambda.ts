import { gzipSync } from 'node:zlib';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createApp } from './app.js';
import { parseCookies } from './http/types.js';
import { isSyncRunning, SyncService, type SyncOptions } from './services/sync.js';
import { HttpSpotifyApi } from './spotify/client.js';
import { DynamoStore } from './store/dynamo.js';

const store = new DynamoStore(process.env.TABLE_NAME!);
const lambda = new LambdaClient({});

async function triggerSync(opts: SyncOptions) {
  await lambda.send(
    new InvokeCommand({
      FunctionName: process.env.SYNC_FUNCTION_NAME!,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(opts)),
    }),
  );
}

/** API Lambda behind API Gateway (HTTP API, payload v2) and CloudFront. */
export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  // A new client per request: token state must not leak between invocations
  // that share a warm container (tokens are cached in the store anyway).
  const app = createApp({
    store,
    spotify: new HttpSpotifyApi(store),
    triggerSync,
    setupCode: process.env.SETUP_CODE || undefined,
    publicUrl: process.env.PUBLIC_URL || undefined,
  });

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(event.headers ?? {})) if (v !== undefined) headers[k.toLowerCase()] = v;

  let body: unknown;
  if (event.body) {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    try {
      body = JSON.parse(raw);
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'bad_request', message: 'Ungültiges JSON' }) };
    }
  }

  const res = await app({
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: Object.fromEntries(Object.entries(event.queryStringParameters ?? {}).map(([k, v]) => [k, v ?? ''])),
    headers,
    cookies: parseCookies(event.cookies ?? headers.cookie),
    body,
  });

  const outHeaders: Record<string, string> = { ...res.headers };
  if (res.body === undefined) {
    return { statusCode: res.status, headers: outHeaders, cookies: res.cookies };
  }
  outHeaders['Content-Type'] = 'application/json; charset=utf-8';
  const text = JSON.stringify(res.body);
  if (text.length > 4096 && /\bgzip\b/.test(headers['accept-encoding'] ?? '')) {
    outHeaders['Content-Encoding'] = 'gzip';
    outHeaders['Vary'] = 'Accept-Encoding';
    return {
      statusCode: res.status,
      headers: outHeaders,
      cookies: res.cookies,
      body: gzipSync(text).toString('base64'),
      isBase64Encoded: true,
    };
  }
  return { statusCode: res.status, headers: outHeaders, cookies: res.cookies, body: text };
}

/**
 * Sync Lambda: invoked asynchronously by the API and by EventBridge (incremental
 * every few hours, `full: true` once a day).
 */
export async function syncHandler(event: SyncOptions & { source?: string }) {
  const config = await store.getConfig();
  const tokens = await store.getTokens();
  if (!config || !tokens) {
    console.log('Not configured yet – skipping sync');
    return;
  }
  const scheduled = event.source === 'aws.events' || event.source === 'schedule';
  if (scheduled && isSyncRunning(await store.getSyncState())) {
    console.log('A sync is already running – skipping scheduled run');
    return;
  }
  const result = await new SyncService(store, new HttpSpotifyApi(store)).run({ full: !!event.full, showId: event.showId });
  console.log('Sync finished', JSON.stringify(result));
  return result;
}
