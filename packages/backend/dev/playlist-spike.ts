/**
 * Throw-away spike: checks whether a playlist managed by the app works with
 * the current Spotify Web API (development mode). It is run by hand with the
 * owner's account and writes a JSON report; it is not part of the app.
 *
 * Run from the repository root, with `pnpm dev` stopped (the script listens on
 * port 5173 for the login redirect):
 *
 *   pnpm --filter @podcast/backend spike:playlist
 *
 * Needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET (from `.env`) and the
 * redirect URI http://127.0.0.1:5173/api/auth/callback in the Spotify app.
 * It logs in on its own with the playlist scopes, creates a private playlist
 * "Podcast-Cockpit spike (delete me)", plays a few seconds of episodes from
 * your saved shows on a device you choose, and offers to delete the playlist
 * at the end. Tokens are never printed or written to the report.
 */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

const API = 'https://api.spotify.com/v1';
const REDIRECT_URI = 'http://127.0.0.1:5173/api/auth/callback';
const SCOPES = [
  'user-library-read',
  'user-read-playback-position',
  'user-read-playback-state',
  'user-modify-playback-state',
  'playlist-modify-private',
  'playlist-read-private',
];
/** Seconds before an episode's end at which a test starts or seeks, so it ends soon. */
const LEAD_MS = 15_000;
const POLL_MS = 2000;

type Json = Record<string, unknown>;

interface Call {
  step: string;
  method: string;
  path: string;
  status: number;
  /** Shortened response body, for failed calls only. */
  error?: string;
}

interface PlayerSample {
  atSec: number;
  isPlaying: boolean;
  itemId?: string;
  itemName?: string;
  itemType?: string;
  contextType?: string;
  contextUri?: string;
  progressSec?: number;
}

interface Episode {
  id: string;
  name: string;
  showName: string;
  durationMs: number;
}

const report = {
  startedAt: new Date().toISOString(),
  grantedScopes: [] as string[],
  premium: undefined as boolean | undefined,
  calls: [] as Call[],
  results: {} as Record<string, unknown>,
};

const rl = createInterface({ input: stdin, output: stdout });
let accessToken = '';

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing (set it in .env)`);
  return value;
}

/** Calls the Web API and records status (and a short error body) in the report. */
async function call(
  step: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  // Paths keep their shape but not the user's or the playlist's id.
  const shape = path
    .replace(API, '')
    .replace(/\/users\/[^/?]+/, '/users/{id}')
    .replace(/\/playlists\/[^/?]+/, '/playlists/{id}');
  const entry: Call = { step, method, path: shape, status: res.status };
  if (!res.ok) entry.error = text.slice(0, 300);
  report.calls.push(entry);
  const retryAfter = res.headers.get('retry-after');
  if (res.status === 429) console.log(`  429 rate limited (Retry-After: ${retryAfter ?? '?'})`);
  return { status: res.status, json };
}

const ok = (status: number) => status >= 200 && status < 300;

async function login(): Promise<void> {
  const clientId = requireEnv('SPOTIFY_CLIENT_ID');
  const clientSecret = requireEnv('SPOTIFY_CLIENT_SECRET');
  const state = randomUUID();
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI);
      if (url.pathname !== '/api/auth/callback') {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get('error');
      const received = url.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(error ? `Login failed: ${error}` : 'Logged in. You can close this tab and go back to the terminal.');
      server.close();
      if (error || !received || url.searchParams.get('state') !== state) {
        reject(new Error(`Login failed: ${error ?? 'missing code or wrong state'}`));
      } else {
        resolve(received);
      }
    });
    server.on('error', (e) => reject(new Error(`Port 5173 is busy – stop \`pnpm dev\` first (${e.message})`)));
    server.listen(5173, '127.0.0.1');
    const authorize = new URL('https://accounts.spotify.com/authorize');
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: SCOPES.join(' '),
      redirect_uri: REDIRECT_URI,
      state,
      show_dialog: 'true',
    }).toString();
    console.log(`\nOpen this URL in your browser and log in with your Spotify account:\n\n${authorize.toString()}\n`);
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
  });
  const json: unknown = await res.json();
  if (!res.ok || !isObject(json) || !str(json.access_token)) {
    throw new Error(`Token exchange failed (${res.status})`);
  }
  accessToken = str(json.access_token) ?? '';
  report.grantedScopes = (str(json.scope) ?? '').split(' ').filter(Boolean);
  const missing = SCOPES.filter((s) => !report.grantedScopes.includes(s));
  console.log(`Logged in. Granted scopes: ${report.grantedScopes.join(', ')}`);
  if (missing.length) console.log(`  Missing scopes: ${missing.join(', ')}`);
}

/** Creates the private test playlist; tries `/me/playlists`, then `/users/{id}/playlists`. */
async function createPlaylist(): Promise<string> {
  const me = await call('profile', 'GET', '/me');
  const userId = isObject(me.json) ? str(me.json.id) : undefined;
  report.premium = isObject(me.json) ? str(me.json.product) === 'premium' : undefined;
  const body = {
    name: 'Podcast-Cockpit spike (delete me)',
    description: 'Created by the Podcast-Cockpit playlist spike. Safe to delete.',
    public: false,
  };
  const attempts = ['/me/playlists', ...(userId ? [`/users/${encodeURIComponent(userId)}/playlists`] : [])];
  for (const path of attempts) {
    const res = await call('create playlist', 'POST', path, body);
    const id = isObject(res.json) ? str(res.json.id) : undefined;
    if (ok(res.status) && id) {
      // The path pattern only, without the user id.
      report.results.createEndpoint = path.startsWith('/me') ? 'POST /me/playlists' : 'POST /users/{id}/playlists';
      console.log(`Created the playlist with ${String(report.results.createEndpoint)}.`);
      return id;
    }
  }
  throw new Error('Could not create a playlist (see the calls in the report)');
}

/** Replaces the playlist's content; tries `/items`, then the older `/tracks`. */
async function replaceItems(step: string, playlistId: string, episodes: Episode[]): Promise<boolean> {
  const uris = episodes.map((e) => `spotify:episode:${e.id}`);
  for (const suffix of ['items', 'tracks']) {
    const res = await call(step, 'PUT', `/playlists/${playlistId}/${suffix}`, { uris });
    if (ok(res.status)) {
      report.results.replaceEndpoint ??= `PUT /playlists/{id}/${suffix}`;
      return true;
    }
  }
  return false;
}

/** The playlist's items as Spotify lists them: id and type of each. */
async function readItems(playlistId: string): Promise<{ id?: string; type?: string }[]> {
  for (const suffix of ['items', 'tracks']) {
    const res = await call('read playlist', 'GET', `/playlists/${playlistId}/${suffix}?limit=50`);
    if (!ok(res.status) || !isObject(res.json) || !Array.isArray(res.json.items)) continue;
    return res.json.items.map((entry: unknown) => {
      const item = isObject(entry) ? (isObject(entry.item) ? entry.item : entry.track) : undefined;
      return isObject(item) ? { id: str(item.id), type: str(item.type) } : {};
    });
  }
  return [];
}

/** A few playable episodes from the first saved shows, two per show. */
async function pickEpisodes(): Promise<Episode[]> {
  const shows = await call('saved shows', 'GET', '/me/shows?limit=10');
  const items = isObject(shows.json) && Array.isArray(shows.json.items) ? shows.json.items : [];
  const episodes: Episode[] = [];
  for (const entry of items) {
    const show = isObject(entry) && isObject(entry.show) ? entry.show : undefined;
    const showId = show ? str(show.id) : undefined;
    if (!show || !showId) continue;
    const res = await call('show episodes', 'GET', `/shows/${showId}/episodes?limit=10`);
    const list = isObject(res.json) && Array.isArray(res.json.items) ? res.json.items : [];
    const playable = list
      .filter(isObject)
      .filter((e) => e.is_playable !== false && str(e.id) && (num(e.duration_ms) ?? 0) > 2 * LEAD_MS)
      .slice(0, 2);
    for (const e of playable) {
      episodes.push({
        id: str(e.id) ?? '',
        name: str(e.name) ?? '?',
        showName: str(show.name) ?? '?',
        durationMs: num(e.duration_ms) ?? 0,
      });
    }
    if (episodes.length >= 4) break;
  }
  if (episodes.length < 4) throw new Error('Need at least four playable episodes in your saved shows');
  return episodes.slice(0, 4);
}

async function chooseDevice(): Promise<string> {
  for (;;) {
    const res = await call('devices', 'GET', '/me/player/devices');
    const devices = isObject(res.json) && Array.isArray(res.json.devices) ? res.json.devices.filter(isObject) : [];
    if (devices.length) {
      console.log('\nDevices:');
      devices.forEach((d, i) => console.log(`  ${i + 1}) ${str(d.name) ?? '?'} (${str(d.type) ?? '?'})`));
      const answer = await rl.question('Play on which device? Number, or Enter to list again: ');
      const device = devices[Number(answer) - 1];
      const id = device ? str(device.id) : undefined;
      if (id) {
        report.results.deviceType = str(device?.type);
        return id;
      }
    } else {
      await rl.question(
        '\nNo device found. Open Spotify on your phone or desktop (or the web app with its player), then press Enter: ',
      );
    }
  }
}

async function sample(startedAt: number): Promise<PlayerSample> {
  const res = await call('player state', 'GET', '/me/player?additional_types=episode');
  const atSec = Math.round((Date.now() - startedAt) / 1000);
  if (!isObject(res.json)) return { atSec, isPlaying: false };
  const item = isObject(res.json.item) ? res.json.item : undefined;
  const context = isObject(res.json.context) ? res.json.context : undefined;
  return {
    atSec,
    isPlaying: res.json.is_playing === true,
    itemId: item ? str(item.id) : undefined,
    itemName: item ? str(item.name) : undefined,
    itemType: item ? str(item.type) : undefined,
    contextType: context ? str(context.type) : undefined,
    contextUri: context ? str(context.uri) : undefined,
    progressSec: Math.round((num(res.json.progress_ms) ?? 0) / 1000),
  };
}

/** Polls the player for `seconds` and keeps the samples where item, context or play state changed. */
async function watch(label: string, seconds: number): Promise<PlayerSample[]> {
  console.log(`  watching for ${seconds}s …`);
  const startedAt = Date.now();
  const changes: PlayerSample[] = [];
  let last = '';
  while (Date.now() - startedAt < seconds * 1000) {
    const s = await sample(startedAt);
    const key = `${s.itemId}|${s.contextUri}|${s.isPlaying}`;
    if (key !== last) {
      changes.push(s);
      console.log(
        `  ${String(s.atSec).padStart(3)}s ${s.isPlaying ? '▶' : '⏸'} ${s.itemType ?? '-'} "${s.itemName ?? '-'}" in ${s.contextUri ?? 'no context'}`,
      );
      last = key;
    }
    await sleep(POLL_MS);
  }
  report.results[label] = changes;
  return changes;
}

const nameOf = (e: Episode) => `"${e.name}" (${e.showName})`;
const playsNext = (changes: PlayerSample[], e: Episode) => changes.some((c) => c.itemId === e.id);

async function main() {
  await login();
  const playlistId = await createPlaylist();
  const playlistUri = `spotify:playlist:${playlistId}`;
  const [e1, e2, e3, e4] = await pickEpisodes();
  if (!e1 || !e2 || !e3 || !e4) return;
  console.log(`Test episodes:\n  1 ${nameOf(e1)}\n  2 ${nameOf(e2)}\n  3 ${nameOf(e3)}\n  4 ${nameOf(e4)}`);

  // 2. Episodes in a playlist
  const replaced = await replaceItems('fill playlist', playlistId, [e1, e2, e3]);
  const listed = await readItems(playlistId);
  report.results.episodesInPlaylist = {
    replaced,
    listedIds: listed.map((i) => i.id),
    listedTypes: listed.map((i) => i.type),
    orderKept: listed.map((i) => i.id).join() === [e1, e2, e3].map((e) => e.id).join(),
  };
  console.log(`Playlist filled: ${replaced}, listed as ${listed.map((i) => i.type).join(', ')}`);

  const deviceId = await chooseDevice();
  const dev = `device_id=${encodeURIComponent(deviceId)}`;

  // 3. Play in the playlist; does Spotify continue with the next item?
  console.log(`\nTest A: play episode 1 near its end inside the playlist; expecting episode 2 next.`);
  const play = await call('play in playlist', 'PUT', `/me/player/play?${dev}`, {
    context_uri: playlistUri,
    offset: { uri: `spotify:episode:${e1.id}` },
    position_ms: e1.durationMs - LEAD_MS,
  });
  const a = await watch('testA_continue', 40);
  report.results.testA = { playStatus: play.status, continuedWithEpisode2: playsNext(a, e2) };

  // 4. Replace while playing; does Spotify follow the new order?
  console.log(`\nTest B: replace the list with [2, 4, 3] while 2 plays, seek near its end; expecting episode 4 next.`);
  const replacedLive = await replaceItems('replace while playing', playlistId, [e2, e4, e3]);
  await call('seek', 'PUT', `/me/player/seek?position_ms=${e2.durationMs - LEAD_MS}&${dev}`);
  const b = await watch('testB_replaceWhilePlaying', 40);
  report.results.testB = {
    replaced: replacedLive,
    keptPlayingEpisode2: b[0]?.itemId === e2.id,
    followedNewOrder: playsNext(b, e4),
    playedOldNext: playsNext(b, e3) && !playsNext(b, e4),
  };

  // 5. After the last item: what plays, and in which context?
  const autoplay = await rl.question('\nIs Autoplay on in the Spotify app of this device? (y/n/?): ');
  report.results.autoplaySetting = autoplay.trim().toLowerCase() || '?';
  console.log(`Test C: play the last item (3) near its end; watching what follows.`);
  await call('play last item', 'PUT', `/me/player/play?${dev}`, {
    context_uri: playlistUri,
    offset: { uri: `spotify:episode:${e3.id}` },
    position_ms: e3.durationMs - LEAD_MS,
  });
  const c = await watch('testC_afterLastItem', 60);
  const after = c.filter((s) => s.atSec > 0 && s.itemId !== e3.id);
  const pause = await call('pause', 'PUT', `/me/player/pause?${dev}`);
  report.results.testC = {
    somethingPlayedAfterEnd: after.some((s) => s.isPlaying),
    contextsAfterEnd: [...new Set(after.map((s) => `${s.contextType ?? 'none'}:${s.contextUri ?? ''}`))],
    stillOurPlaylist: after.some((s) => s.contextUri === playlistUri),
    pauseStatus: pause.status,
  };

  // 6. Rate limits: replacing several times in a row
  console.log('\nTest D: replace the list five times in a row.');
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) {
    await replaceItems(`replace burst ${i + 1}`, playlistId, i % 2 ? [e1, e2, e3, e4] : [e4, e3, e2, e1]);
    statuses.push(report.calls.at(-1)?.status ?? 0);
  }
  report.results.testD = { statuses };

  const remove = await rl.question('\nDelete the test playlist now? (Y/n): ');
  if (remove.trim().toLowerCase() !== 'n') {
    const del = await call('delete playlist', 'DELETE', `/playlists/${playlistId}/followers`);
    if (!ok(del.status)) {
      await call('delete playlist (library)', 'DELETE', `/me/library?uris=${encodeURIComponent(playlistUri)}`);
    }
  }
}

try {
  await main();
} catch (e) {
  report.results.error = e instanceof Error ? e.message : String(e);
  console.error(`\nStopped: ${String(report.results.error)}`);
} finally {
  rl.close();
  const file = join(tmpdir(), `playlist-spike-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${file}\nIt holds no tokens or account ids; please send its content.`);
}
