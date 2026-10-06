import { vi } from 'vitest';

type Listener = (payload: unknown) => void;
type PlayerOptions = ConstructorParameters<typeof Spotify.Player>[0];

/** How connecting a FakePlayer ends: an SDK event, or no answer at all. */
export type ConnectOutcome = 'ready' | 'account_error' | 'authentication_error' | 'initialization_error' | 'no_answer';

/** The SDK's message for each failed connect. */
const ERRORS = {
  account_error: 'no premium',
  authentication_error: 'invalid token',
  initialization_error: 'no EME',
} as const;

/**
 * Stand-in for the Web Playback SDK's player, installed with `installFakeSdk`.
 * `nextConnect` decides how connecting ends; `emit` sends SDK events.
 */
export class FakePlayer {
  static instances: FakePlayer[] = [];
  static nextConnect: ConnectOutcome = 'ready';
  readonly listeners = new Map<string, Listener[]>();
  state: Spotify.PlaybackState | null = null;
  disconnect = vi.fn();
  seek = vi.fn(async (_positionMs: number) => {});
  constructor(readonly options: PlayerOptions) {
    FakePlayer.instances.push(this);
  }
  addListener(event: string, cb: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
    return true;
  }
  emit(event: string, payload: unknown) {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }
  async connect() {
    const outcome = FakePlayer.nextConnect;
    if (outcome === 'no_answer') return true;
    setTimeout(() =>
      outcome === 'ready' ? this.emit('ready', { device_id: 'web' }) : this.emit(outcome, { message: ERRORS[outcome] }),
    );
    return true;
  }
  getCurrentState = async () => this.state;
  togglePlay = async () => {};
  pause = async () => {};
  activateElement = async () => {};
}

/** Makes this browser support the SDK and provides FakePlayer as `Spotify.Player`. */
export function installFakeSdk() {
  FakePlayer.instances = [];
  FakePlayer.nextConnect = 'ready';
  vi.stubGlobal('MediaKeys', function MediaKeys() {});
  vi.stubGlobal('Spotify', { Player: FakePlayer });
}

/** A state as the SDK reports it for `episodeId` (20 minutes long) at `positionMs`. */
export function sdkState(episodeId: string, positionMs: number, paused = false): Spotify.PlaybackState {
  const uri = `spotify:episode:${episodeId}`;
  return {
    paused,
    position: positionMs,
    duration: 20 * 60_000,
    track_window: { current_track: { id: episodeId, uri, name: '', type: 'episode' } },
  };
}
