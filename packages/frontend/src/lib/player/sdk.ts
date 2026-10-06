import { useCallback, useEffect, useMemo, useRef } from 'react';
import i18n from '../../i18n';
import { api } from '../api';
import { useToast } from '../toast';

/** Name of the Spotify Connect device this browser becomes. */
export const BROWSER_DEVICE_NAME = 'Podcast-Cockpit';
// Overridable so local development can load a fake SDK (see packages/frontend/dev).
const SDK_URL = import.meta.env.VITE_SPOTIFY_SDK_URL || 'https://sdk.scdn.co/spotify-player.js';
/** How long the browser device may take to come online. */
const READY_TIMEOUT_MS = 15_000;
/** How often the browser player's position is read while it plays. */
const POLL_MS = 1000;

/** The Web Playback SDK does not support mobile browsers. */
export function detectBrowserSupport(): boolean {
  if (typeof navigator === 'undefined') return false;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return !mobile && 'MediaKeys' in window;
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  sdkPromise ??= new Promise<void>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.addEventListener('error', () => {
      sdkPromise = null;
      reject(new Error(i18n.t('sdk.loadFailed', { ns: 'player' })));
    });
    document.body.appendChild(script);
  });
  return sdkPromise;
}

/** Controls of the in-browser Spotify device. */
export interface BrowserDevice {
  /** Creates the device once (loading the SDK) and resolves with its id. */
  ensureDevice: () => Promise<string>;
  /** Must be called synchronously inside the click that starts playback (Safari/Firefox autoplay rules). */
  activate: () => void;
  togglePlay: () => void;
  seek: (positionMs: number) => void;
  pause: () => void;
}

/**
 * The browser as a Spotify Connect device. The hook owns the SDK player: it
 * connects it on the first `ensureDevice`, reports its state through
 * `onState` (every second as well while `polling`), and disconnects it when
 * it goes offline, so the next play creates a fresh one.
 */
export function useBrowserDevice(onState: (state: Spotify.PlaybackState) => void, polling: boolean): BrowserDevice {
  const toast = useToast();
  const playerRef = useRef<Spotify.Player | null>(null);
  const deviceRef = useRef<Promise<string> | null>(null);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  const discardPlayer = useCallback((player: Spotify.Player) => {
    player.disconnect();
    if (playerRef.current === player) playerRef.current = null;
    deviceRef.current = null;
  }, []);

  const ensureDevice = useCallback((): Promise<string> => {
    if (deviceRef.current) return deviceRef.current;
    deviceRef.current = (async () => {
      await loadSdk();
      const player = new window.Spotify.Player({
        name: BROWSER_DEVICE_NAME,
        volume: 0.9,
        getOAuthToken: (cb) => {
          api
            .playerToken()
            .then((t) => cb(t.accessToken))
            .catch(() => toast({ message: i18n.t('sdk.tokenFailed', { ns: 'player' }), tone: 'error' }));
        },
      });
      playerRef.current = player;
      const deviceId = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(i18n.t('sdk.timeout', { ns: 'player' }))), READY_TIMEOUT_MS);
        player.addListener('ready', ({ device_id }) => {
          clearTimeout(timer);
          resolve(device_id);
        });
        const fail = (prefix: string) => (e: Spotify.ErrorPayload) => {
          clearTimeout(timer);
          reject(new Error(`${prefix}: ${e.message}`));
        };
        player.addListener('initialization_error', fail(i18n.t('sdk.unsupported', { ns: 'player' })));
        player.addListener('authentication_error', fail(i18n.t('sdk.authFailed', { ns: 'player' })));
        player.addListener('account_error', fail(i18n.t('sdk.premiumRequired', { ns: 'player' })));
        void player.connect();
      });
      player.addListener('playback_error', (e) =>
        toast({ message: i18n.t('sdk.playbackError', { ns: 'player', message: e.message }), tone: 'error' }),
      );
      player.addListener('autoplay_failed', () =>
        toast({ message: i18n.t('sdk.autoplayBlocked', { ns: 'player' }), tone: 'error' }),
      );
      // An offline device is replaced by a new player on the next play; two
      // connected players would show up as two devices and report twice.
      player.addListener('not_ready', () => discardPlayer(player));
      player.addListener('player_state_changed', (state) => {
        if (state) onStateRef.current(state);
      });
      return deviceId;
    })();
    deviceRef.current.catch(() => {
      if (playerRef.current) discardPlayer(playerRef.current);
      deviceRef.current = null;
    });
    return deviceRef.current;
  }, [toast, discardPlayer]);

  // A reading that fails is simply taken a second later.
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      void playerRef.current?.getCurrentState().then(
        (state) => {
          if (state) onStateRef.current(state);
        },
        () => undefined,
      );
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [polling]);

  return useMemo(
    () => ({
      ensureDevice,
      activate: () => void playerRef.current?.activateElement(),
      togglePlay: () => void playerRef.current?.togglePlay(),
      seek: (positionMs: number) => void playerRef.current?.seek(positionMs),
      pause: () => void playerRef.current?.pause(),
    }),
    [ensureDevice],
  );
}
