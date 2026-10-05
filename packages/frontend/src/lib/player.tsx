import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EpisodeView } from '@podcast/shared';
import i18n from '../i18n';
import { api, ApiError } from './api';
import { useInvalidateLibrary, useSettings } from './queries';
import { useToast } from './toast';

/** Where "Abspielen" sends an episode. */
export type PlayTarget =
  | { kind: 'browser' }
  | { kind: 'app' }
  | { kind: 'device'; id: string; name: string };

export interface NowPlaying {
  showId: string;
  episodeId: string;
  name: string;
  showName: string;
  imageUrl?: string;
  durationMs: number;
  positionMs: number;
  paused: boolean;
  target: PlayTarget;
  /** True once we marked it as completed automatically. */
  completed: boolean;
}

export interface PlayableItem {
  show: { id: string; name: string; imageUrl?: string };
  episode: Pick<EpisodeView, 'id' | 'name' | 'durationMs' | 'spotifyUrl' | 'imageUrl' | 'status' | 'statusSource'>;
}

interface PlayerApi {
  target: PlayTarget;
  setTarget: (t: PlayTarget) => void;
  browserSupported: boolean;
  nowPlaying: NowPlaying | null;
  busy: boolean;
  play: (item: PlayableItem, opts?: PlayOptions) => Promise<void>;
  togglePause: () => void;
  seekBy: (deltaMs: number) => void;
  seekTo: (ms: number) => void;
  close: () => void;
}

export interface PlayOptions {
  fromStart?: boolean;
  /** Start at this position (e.g. a timestamp from a note). */
  positionMs?: number;
}

const PlayerContext = createContext<PlayerApi | null>(null);
const TARGET_KEY = 'pm.playTarget';
// Overridable so local development can load a fake SDK (see packages/frontend/dev).
const SDK_URL = import.meta.env.VITE_SPOTIFY_SDK_URL || 'https://sdk.scdn.co/spotify-player.js';

/** The Web Playback SDK does not support mobile browsers. */
function detectBrowserSupport(): boolean {
  if (typeof navigator === 'undefined') return false;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return !mobile && 'MediaKeys' in window;
}

function loadTarget(fallback: PlayTarget): PlayTarget {
  try {
    const raw = localStorage.getItem(TARGET_KEY);
    if (raw) return JSON.parse(raw) as PlayTarget;
  } catch {
    // ignore
  }
  return fallback;
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (window.Spotify) return Promise.resolve();
  sdkPromise ??= new Promise<void>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error(i18n.t('sdk.loadFailed', { ns: 'player' })));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useSettings();
  const toast = useToast();
  const invalidate = useInvalidateLibrary();
  const browserSupported = useMemo(detectBrowserSupport, []);

  const [target, setTargetState] = useState<PlayTarget>(() =>
    loadTarget(detectBrowserSupport() ? { kind: 'browser' } : { kind: 'app' }),
  );
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [busy, setBusy] = useState(false);
  const playerRef = useRef<Spotify.Player | null>(null);
  const deviceRef = useRef<Promise<string> | null>(null);
  const nowRef = useRef<NowPlaying | null>(null);
  nowRef.current = nowPlaying;

  const setTarget = useCallback((t: PlayTarget) => {
    setTargetState(t);
    try {
      localStorage.setItem(TARGET_KEY, JSON.stringify(t));
    } catch {
      // ignore
    }
  }, []);

  /** Creates the in-browser Spotify device once and resolves with its id. */
  const ensureBrowserDevice = useCallback((): Promise<string> => {
    if (deviceRef.current) return deviceRef.current;
    deviceRef.current = (async () => {
      await loadSdk();
      const player = new window.Spotify!.Player({
        name: 'Podcast-Cockpit',
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
        const timer = setTimeout(() => reject(new Error(i18n.t('sdk.timeout', { ns: 'player' }))), 15000);
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
      player.addListener('not_ready', () => {
        deviceRef.current = null;
      });
      player.addListener('player_state_changed', (state) => {
        const cur = nowRef.current;
        if (!state || !cur || cur.target.kind !== 'browser') return;
        setNowPlaying({ ...cur, paused: state.paused, positionMs: state.position, durationMs: state.duration || cur.durationMs });
      });
      return deviceId;
    })();
    deviceRef.current.catch(() => {
      deviceRef.current = null;
    });
    return deviceRef.current;
  }, [toast]);

  const play = useCallback(
    async (item: PlayableItem, opts: PlayOptions = {}) => {
      const t = target.kind === 'browser' && !browserSupported ? ({ kind: 'app' } as PlayTarget) : target;
      if (t.kind === 'app') {
        window.open(item.episode.spotifyUrl, '_blank', 'noopener');
        return;
      }
      // Must happen synchronously inside the click for Safari/Firefox autoplay rules.
      void playerRef.current?.activateElement();
      setBusy(true);
      try {
        let deviceId: string | undefined;
        if (t.kind === 'device') deviceId = t.id;
        else deviceId = await ensureBrowserDevice();
        const request = {
          showId: item.show.id,
          episodeId: item.episode.id,
          deviceId,
          fromStart: opts.fromStart,
          positionMs: opts.positionMs,
        };
        let res;
        try {
          res = await api.play(request);
        } catch (e) {
          // A freshly created browser device can take a moment until Spotify knows it.
          if (!(e instanceof ApiError) || e.status !== 404 || t.kind !== 'browser') throw e;
          await new Promise((r) => setTimeout(r, 1500));
          res = await api.play(request);
        }
        setNowPlaying({
          showId: item.show.id,
          episodeId: item.episode.id,
          name: item.episode.name,
          showName: item.show.name,
          imageUrl: item.episode.imageUrl ?? item.show.imageUrl,
          durationMs: res.durationMs || item.episode.durationMs,
          positionMs: res.positionMs,
          paused: false,
          target: t,
          completed: item.episode.status === 'COMPLETED',
        });
        if (t.kind === 'device') toast({ message: i18n.t('playingOn', { ns: 'player', device: t.name }) });
      } catch (e) {
        toast({ message: (e as Error).message, tone: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [target, browserSupported, ensureBrowserDevice, toast],
  );

  // Poll the browser player while playing.
  useEffect(() => {
    if (!nowPlaying || nowPlaying.paused || nowPlaying.target.kind !== 'browser') return;
    const timer = setInterval(async () => {
      const state = await playerRef.current?.getCurrentState();
      if (state) {
        setNowPlaying((cur) =>
          cur ? { ...cur, positionMs: state.position, paused: state.paused, durationMs: state.duration || cur.durationMs } : cur,
        );
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [nowPlaying?.episodeId, nowPlaying?.paused, nowPlaying?.target.kind]);

  // Auto-complete near the end of the episode.
  useEffect(() => {
    const cur = nowPlaying;
    if (!cur || cur.completed || !settings?.autoCompleteInPlayer || cur.target.kind !== 'browser') return;
    const remaining = cur.durationMs - cur.positionMs;
    if (cur.durationMs > 0 && (remaining < 20_000 || cur.positionMs / cur.durationMs > 0.97)) {
      setNowPlaying({ ...cur, completed: true });
      api
        .setStatus(cur.showId, cur.episodeId, 'COMPLETED')
        .then(() => {
          void invalidate();
          toast({
            message: i18n.t('episode.autoCompleted', { name: cur.name }),
            tone: 'success',
            action: {
              label: i18n.t('episode.undo'),
              onClick: () => void api.setStatus(cur.showId, cur.episodeId, null).then(invalidate),
            },
          });
        })
        .catch(() => undefined);
    }
  }, [nowPlaying, settings?.autoCompleteInPlayer, invalidate, toast]);

  const togglePause = useCallback(() => {
    const cur = nowRef.current;
    if (!cur) return;
    void playerRef.current?.togglePlay();
    setNowPlaying({ ...cur, paused: !cur.paused });
  }, []);

  const seekTo = useCallback(
    (ms: number) => {
      const cur = nowRef.current;
      if (!cur) return;
      const pos = Math.max(0, Math.min(cur.durationMs - 1000, ms));
      void playerRef.current?.seek(pos);
      setNowPlaying({ ...cur, positionMs: pos });
    },
    [],
  );

  const seekBy = useCallback((delta: number) => seekTo((nowRef.current?.positionMs ?? 0) + delta), [seekTo]);

  const close = useCallback(() => {
    if (nowRef.current?.target.kind === 'browser') void playerRef.current?.pause();
    setNowPlaying(null);
  }, []);

  const value = useMemo(
    () => ({ target, setTarget, browserSupported, nowPlaying, busy, play, togglePause, seekBy, seekTo, close }),
    [target, setTarget, browserSupported, nowPlaying, busy, play, togglePause, seekBy, seekTo, close],
  );
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer outside PlayerProvider');
  return ctx;
}
