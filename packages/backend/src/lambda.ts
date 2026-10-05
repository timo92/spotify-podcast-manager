import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { handle } from '@hono/aws-lambda';
import { createApp } from './app.js';
import { applyRetention } from './services/retention.js';
import { isSyncRunning, SyncService, type SyncOptions } from './services/sync.js';
import { HttpSpotifyApi } from './spotify/client.js';
import { credentialsFromEnv } from './spotify/credentials.js';
import { DynamoStore } from './store/dynamo.js';

const store = new DynamoStore(process.env.TABLE_NAME!);
const lambda = new LambdaClient({});
const credentials = credentialsFromEnv();

async function triggerSync(opts: SyncOptions) {
  await lambda.send(
    new InvokeCommand({
      FunctionName: process.env.SYNC_FUNCTION_NAME!,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify(opts)),
    }),
  );
}

const app = createApp({
  store,
  spotify: () => new HttpSpotifyApi(store, credentials),
  credentials,
  triggerSync,
  publicUrl: process.env.PUBLIC_URL || undefined,
});

/** API Lambda behind API Gateway (HTTP API, payload v2) and CloudFront. */
export const handler = handle(app);

/**
 * Sync Lambda: invoked asynchronously by the API and by EventBridge (incremental
 * every few hours, `full: true` once a day).
 */
export async function syncHandler(event: SyncOptions & { source?: string }) {
  const config = await store.getConfig();
  const tokens = await store.getTokens();
  if (!config || !tokens) {
    // Not connected (yet, or access was revoked): there is nothing to sync, but
    // data of a revoked connection still has to expire.
    const retention = await applyRetention(store);
    console.log('Not connected – skipping sync', JSON.stringify(retention));
    return;
  }
  const scheduled = event.source === 'aws.events' || event.source === 'schedule';
  if (scheduled && isSyncRunning(await store.getSyncState())) {
    console.log('A sync is already running – skipping scheduled run');
    return;
  }
  const result = await new SyncService(store, new HttpSpotifyApi(store, credentials)).run({ full: !!event.full, showId: event.showId });
  console.log('Sync finished', JSON.stringify(result));
  return result;
}
