/**
 * Local development server: serves the API on http://127.0.0.1:8787 (Vite
 * proxies /api to it). Data is kept in .local-data/.
 *
 * Configuration comes from the environment or the repository's `.env` file
 * (see .env.example; loaded by the package scripts via --env-file-if-exists):
 *   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET   your Spotify developer app
 *   --demo           offline demo (or SPOTIFY_FAKE=1): fake Spotify (shows,
 *                    login, playback), no Spotify app needed. A CLI flag
 *                    rather than an env prefix, so the script also runs on
 *                    Windows.
 *   TABLE_NAME=…     use a real DynamoDB table instead of the JSON file
 *   PUBLIC_URL=…     the UI's public URL for login redirects; in GitHub
 *                    Codespaces it defaults to the forwarded URL of the UI
 *
 * Everything demo-specific lives here and in test/fakes – the app itself has
 * no demo mode.
 */
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createApp } from '../src/app.js';
import { SyncService, type SyncOptions } from '../src/services/sync.js';
import { HttpSpotifyApi } from '../src/spotify/client.js';
import { credentialsFromEnv, staticCredentials } from '../src/spotify/credentials.js';
import type { SpotifyApi } from '../src/spotify/types.js';
import { DynamoStore } from '../src/store/dynamo.js';
import { MemoryStore } from '../src/store/memory.js';
import type { Store } from '../src/store/types.js';
import { FakeSpotifyApi, fakeSpotifyAuth } from '../test/fakes/fake-spotify.js';
import { codespacesPublicUrl } from './codespaces.js';

const demo = process.argv.includes('--demo') || process.env.SPOTIFY_FAKE === '1';
const port = Number(process.env.PORT ?? 8787);
const dataFile = resolve(process.cwd(), process.env.DATA_FILE ?? `.local-data/${demo ? 'demo' : 'db'}.json`);
const store: Store = process.env.TABLE_NAME ? new DynamoStore(process.env.TABLE_NAME) : new MemoryStore(dataFile);
const credentials = demo ? staticCredentials('demo-client', 'demo-secret') : credentialsFromEnv();

// One fake instance, so its playback state survives between requests.
const fake = demo ? new FakeSpotifyApi() : undefined;
const spotify = (): SpotifyApi => fake ?? new HttpSpotifyApi(store, credentials);

async function triggerSync(opts: SyncOptions) {
  // Fire and forget, like the async Lambda invocation in AWS.
  void new SyncService(store, spotify())
    .run(opts)
    .then((s) => console.log('[sync]', s.status, s.message ?? s.error ?? ''))
    .catch((e: unknown) => console.error('[sync] failed', e));
}

const app = createApp({
  store,
  spotify,
  credentials,
  auth: demo ? fakeSpotifyAuth : undefined,
  triggerSync,
  publicUrl: process.env.PUBLIC_URL ?? codespacesPublicUrl(process.env),
});

const root = new Hono();
if (fake) {
  // Playback state for the fake Web Playback SDK (packages/frontend/dev/fake-spotify-player.js).
  root.get('/api/__fake/player', (c) => c.json(fake.playbackState()));
  root.post('/api/__fake/player', async (c) => {
    const { action, positionMs } = await c.req.json<{ action: 'toggle' | 'pause' | 'seek'; positionMs?: number }>();
    return c.json(fake.controlPlayback(action, positionMs));
  });
}
root.use('*', async (c, next) => {
  await next();
  console.log(`${c.req.method} ${c.req.path} → ${c.res.status}`);
});
root.route('/', app);

serve({ fetch: root.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`API listening on http://127.0.0.1:${port} (${demo ? 'demo: fake Spotify' : 'real Spotify'})`);
  console.log(`Data: ${process.env.TABLE_NAME ? `DynamoDB table ${process.env.TABLE_NAME}` : dataFile}`);
  void credentials.ready().then((ok) => {
    if (!ok) console.warn('Spotify credentials missing – copy .env.example to .env and fill in your Spotify app.');
  });
});
