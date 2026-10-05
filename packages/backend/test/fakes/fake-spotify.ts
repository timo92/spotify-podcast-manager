import type { SpotifyAuth } from '../../src/spotify/auth.js';
import { SCOPES } from '../../src/spotify/client.js';
import type { SpotifyApi, SpotifyDevice, SpotifyEpisode, SpotifyShow } from '../../src/spotify/types.js';

const DAY = 24 * 60 * 60 * 1000;

interface FakeShowDef {
  id: string;
  name: string;
  description: string;
  color: string;
  count: number;
  everyDays: number;
  minutes: [number, number];
  topic: string;
}

const DEFS: FakeShowDef[] = [
  {
    id: 'demo-dertag',
    name: 'Der Tag',
    description: 'Die tägliche Nachrichten-Einordnung: ein Thema, das den Tag bestimmt.',
    color: '#d1495b',
    count: 40,
    everyDays: 1,
    minutes: [28, 34],
    topic: 'Nachrichtenlage',
  },
  {
    id: 'demo-seinundstreit',
    name: 'Sein und Streit',
    description: 'Das Philosophiemagazin – Gespräche über große Fragen.',
    color: '#00798c',
    count: 63,
    everyDays: 7,
    minutes: [45, 55],
    topic: 'Philosophie',
  },
  {
    id: 'demo-restgeschichte',
    name: 'Der Rest ist Geschichte',
    description: 'Ein Geschichtspodcast über die großen und kleinen Momente der Vergangenheit.',
    color: '#edae49',
    count: 91,
    everyDays: 7,
    minutes: [35, 60],
    topic: 'Geschichte',
  },
  {
    id: 'demo-wissensreise',
    name: 'Wissensreise',
    description: 'Geographie zum Hören: Länder, Landschaften und Menschen.',
    color: '#30638e',
    count: 42,
    everyDays: 10,
    minutes: [15, 25],
    topic: 'Reise',
  },
  {
    id: 'demo-wirtschaft',
    name: 'Wirtschaft kompakt',
    description: 'Die wichtigsten Wirtschaftsnachrichten in zehn Minuten – jeden Morgen.',
    color: '#5c946e',
    count: 25,
    everyDays: 1,
    minutes: [8, 12],
    topic: 'Märkte',
  },
];

function cover(def: FakeShowDef): string {
  const initials = def.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="${def.color}"/><text x="150" y="175" font-family="sans-serif" font-size="90" font-weight="700" fill="#fff" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** Deterministic pseudo random number in [0, 1). */
function rand(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/** Speed-up of the fake playback clock, so episodes "finish" within a minute or two. */
const FAKE_PLAYBACK_SPEED = 30;

export interface FakePlaybackState {
  episodeId: string | null;
  durationMs: number;
  positionMs: number;
  paused: boolean;
}

/**
 * Offline stand-in for Spotify, used by tests and by the dev server's demo
 * mode (SPOTIFY_FAKE=1). Generates a handful of shows whose newest episode is
 * always "today" and keeps a fake playback state that the fake Web Playback
 * SDK (packages/frontend/dev) reads, just like the real SDK follows Spotify.
 */
export class FakeSpotifyApi implements SpotifyApi {
  private readonly shows: SpotifyShow[];
  private readonly episodes = new Map<string, SpotifyEpisode[]>();

  constructor(now = new Date()) {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    this.shows = DEFS.map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      images: [{ url: cover(def), width: 300, height: 300 }],
      external_urls: { spotify: `https://open.spotify.com/show/${def.id}` },
      total_episodes: def.count,
      media_type: 'audio',
    }));
    DEFS.forEach((def, s) => {
      const eps: SpotifyEpisode[] = [];
      for (let i = 0; i < def.count; i++) {
        const number = def.count - i;
        const date = new Date(today - i * def.everyDays * DAY).toISOString().slice(0, 10);
        const minutes = def.minutes[0] + Math.round(rand(s * 1000 + i) * (def.minutes[1] - def.minutes[0]));
        const durationMs = minutes * 60_000;
        eps.push({
          id: `${def.id}-${number}`,
          name: def.everyDays === 1 ? `${def.topic} am ${date}` : `#${number} – ${def.topic}: Teil ${number}`,
          description: `Folge ${number} von „${def.name}“. ${def.description} Dies ist eine Demo-Episode ohne echte Audiodaten.`,
          release_date: date,
          release_date_precision: 'day',
          duration_ms: durationMs,
          images: this.shows[s].images,
          external_urls: { spotify: `https://open.spotify.com/episode/${def.id}-${number}` },
          is_playable: true,
          // "Sein und Streit": 1–2 heard, 3 started; "Der Rest ist Geschichte": 1–2 heard.
          resume_point:
            s === 1 && number === 3
              ? { fully_played: false, resume_position_ms: Math.round(durationMs * 0.4) }
              : { fully_played: (s === 1 || s === 2) && number <= 2, resume_position_ms: 0 },
        });
      }
      this.episodes.set(def.id, eps);
    });
  }

  async getMe() {
    return { id: 'demo-user', display_name: 'Demo' };
  }

  async getSavedShows() {
    return structuredClone(this.shows);
  }

  async getShowEpisodes(showId: string, stopAfterPage?: (page: SpotifyEpisode[]) => boolean) {
    const all = this.episodes.get(showId) ?? [];
    const out: SpotifyEpisode[] = [];
    for (let i = 0; i < all.length; i += 50) {
      const page = all.slice(i, i + 50);
      out.push(...page);
      if (stopAfterPage?.(page)) break;
    }
    return structuredClone(out);
  }

  async getEpisode(episodeId: string) {
    for (const eps of this.episodes.values()) {
      const ep = eps.find((e) => e.id === episodeId);
      if (ep) return structuredClone(ep);
    }
    return undefined;
  }

  async getDevices(): Promise<SpotifyDevice[]> {
    return [{ id: 'demo-phone', name: 'Handy (Demo)', type: 'Smartphone', is_active: false }];
  }

  private playback = { episodeId: null as string | null, durationMs: 0, positionMs: 0, paused: true, since: Date.now() };

  async play(episodeId: string, _deviceId: string | undefined, positionMs: number) {
    const ep = await this.getEpisode(episodeId);
    this.playback = { episodeId, durationMs: ep?.duration_ms ?? 0, positionMs, paused: false, since: Date.now() };
  }

  /** Current fake playback state (position advances while not paused). */
  playbackState(): FakePlaybackState {
    const p = this.playback;
    const elapsed = p.paused ? 0 : (Date.now() - p.since) * FAKE_PLAYBACK_SPEED;
    return {
      episodeId: p.episodeId,
      durationMs: p.durationMs,
      positionMs: Math.min(p.durationMs, p.positionMs + elapsed),
      paused: p.paused,
    };
  }

  controlPlayback(action: 'toggle' | 'pause' | 'seek', positionMs?: number) {
    const now = this.playbackState();
    this.playback = {
      ...this.playback,
      positionMs: action === 'seek' && typeof positionMs === 'number' ? positionMs : now.positionMs,
      paused: action === 'toggle' ? !now.paused : action === 'pause' ? true : now.paused,
      since: Date.now(),
    };
    return this.playbackState();
  }

  async getAccessToken() {
    return { accessToken: 'demo', expiresAt: Date.now() + 3600_000 };
  }
}

/** Fake login: "Spotify" immediately redirects back with a code for the demo user. */
export const fakeSpotifyAuth: SpotifyAuth = {
  authorizeUrl: (_clientId, redirectUri, state) => `${redirectUri}?code=demo&state=${encodeURIComponent(state)}`,
  async login() {
    return {
      tokens: { accessToken: 'demo', refreshToken: 'demo', expiresAt: Date.now() + 3600_000, scope: SCOPES.join(' ') },
      user: { id: 'demo-user', display_name: 'Demo' },
    };
  },
  async verifyCredentials() {},
};
