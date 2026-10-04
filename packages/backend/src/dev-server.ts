/**
 * Local development server: serves the API on http://127.0.0.1:8787 (Vite
 * proxies /api to it). Data is kept in .local-data/db.json.
 *
 *   SPOTIFY_FAKE=1  offline demo with generated podcasts (no Spotify app needed)
 *   SETUP_CODE=…    require a setup code like the deployed app does
 *   TABLE_NAME=…    use a real DynamoDB table instead of the JSON file
 */
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { parseCookies } from './http/types.js';
import { SyncService, type SyncOptions } from './services/sync.js';
import { HttpSpotifyApi } from './spotify/client.js';
import { FakeSpotifyApi } from './spotify/fake.js';
import { DynamoStore } from './store/dynamo.js';
import { MemoryStore } from './store/memory.js';
import type { Store } from './store/types.js';

const demo = process.env.SPOTIFY_FAKE === '1';
const port = Number(process.env.PORT ?? 8787);
const dataFile = resolve(process.cwd(), process.env.DATA_FILE ?? `.local-data/${demo ? 'demo' : 'db'}.json`);
const store: Store = process.env.TABLE_NAME ? new DynamoStore(process.env.TABLE_NAME) : new MemoryStore(dataFile);
const spotify = () => (demo ? new FakeSpotifyApi() : new HttpSpotifyApi(store));

async function triggerSync(opts: SyncOptions) {
  // Fire and forget, like the async Lambda invocation in AWS.
  void new SyncService(store, spotify())
    .run(opts)
    .then((s) => console.log('[sync]', s.status, s.message ?? s.error ?? ''));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  let body: unknown;
  if (chunks.length) {
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      res.writeHead(400).end();
      return;
    }
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;

  const app = createApp({
    store,
    spotify: spotify(),
    triggerSync,
    setupCode: process.env.SETUP_CODE,
    publicUrl: process.env.PUBLIC_URL,
    demo,
  });
  const out = await app({
    method: req.method ?? 'GET',
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers,
    cookies: parseCookies(req.headers.cookie),
    body,
  });
  const outHeaders: Record<string, string | string[]> = { ...out.headers };
  if (out.cookies?.length) outHeaders['Set-Cookie'] = out.cookies;
  if (out.body !== undefined) outHeaders['Content-Type'] = 'application/json; charset=utf-8';
  res.writeHead(out.status, outHeaders);
  res.end(out.body !== undefined ? JSON.stringify(out.body) : undefined);
  console.log(`${req.method} ${url.pathname} → ${out.status}`);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`API listening on http://127.0.0.1:${port} (${demo ? 'demo mode, fake Spotify' : 'real Spotify'})`);
  console.log(`Data: ${process.env.TABLE_NAME ? `DynamoDB table ${process.env.TABLE_NAME}` : dataFile}`);
});
