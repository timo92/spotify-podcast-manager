import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EpisodeView, PlaybackState } from '@podcast/shared';
import i18n from '../i18n';
import { api, ApiError } from './api';
import { useInvalidateLibrary, useSettings } from './queries';
import { playbackEnded } from './playback-end';
import { forgetRemoteEpisode, loadRemoteEpisodes, rememberRemoteEpisode, type RemoteEpisode } from './remote-episodes';
import { LISTEN_ON_SPOTIFY } from '../components/SpotifyAttribution';
import { useToast } from './toast';

/** Where "Abspielen" sends an episode. */
export type PlayTarget = { kind: 'browser' } | { kind: 'app' } | { kind: 'device'; id: string; name: string };

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
  /** For playback outside the browser: the device Spotify reports it on. */
  deviceName?: string;
}

export interface PlayableItem {
  show: { id: string; name: string; imageUrl?: string };
  episode: Pick<EpisodeView, 'id' | 'name' | 'durationMs' | 'spotifyUrl' | 'imageUrl' | 'status' | 'statusSource'>;
}

/**
 * A playable item for an episode known only by ids and names (from a note or
 * the player): enough to play it and to link to it on Spotify.
 */
export function episodeItem(ref: {
  showId: string;
  showName?: string;
  episodeId: string;
  episodeName?: string;
  durationMs?: number;
  imageUrl?: string;
}): PlayableItem {
  return {
    show: { id: ref.showId, name: ref.showName ?? '', imageUrl: ref.imageUrl },
    episode: {
      id: ref.episodeId,
      name: ref.episodeName ?? '',
      durationMs: ref.durationMs ?? 0,
      spotifyUrl: `https://open.spotify.com/episode/${ref.episodeId}`,
      status: 'UNSEEN',
      statusSource: 'default',
    },
  };
}

function remoteEpisode(item: PlayableItem, target: PlayTarget): RemoteEpisode {
  return {
    showId: item.show.id,
    episodeId: item.episode.id,
    name: item.episode.name,
    showName: item.show.name,
    imageUrl: item.episode.imageUrl ?? item.show.imageUrl,
    durationMs: item.episode.durationMs,
    target,
    startedAt: Date.now(),
  };
}

/**
 * The browser player's state applied to the shown episode. A state of another
 * episode (Spotify autoplays the next one, or starts one the app is about to
 * show) means the shown one stopped; its position is never taken over.
 */
function applySdkState(cur: NowPlaying, state: Spotify.PlaybackState): NowPlaying {
  const track = state.track_window.current_track;
  if (track && track.uri !== `spotify:episode:${cur.episodeId}`) return cur.paused ? cur : { ...cur, paused: true };
  return { ...cur, paused: state.paused, positionMs: state.position, durationMs: state.duration || cur.durationMs };
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
  /** Records that the user marked the shown episode as heard, so it isn't marked again when it ends. */
  markCompleted: (episodeId: string) => void;
  close: () => void;
}

export interface PlayOptions {
  fromStart?: boolean;
  /** Start at this position (e.g. a timestamp from a note). */
  positionMs?: number;
}

const PlayerContext = createContext<PlayerApi | null>(null);
const TARGET_KEY = 'pm.playTarget';
/** How often playback outside the browser is read from Spotify while the page is visible. */
const REMOTE_POLL_MS = 30_000;
/** How close to its end the browser player must have been for an episode to count as ended. */
const BROWSER_END_WINDOW_MS = 5_000;
/** Polls without movement after which following outside playback stops (it was paused or ended). */
const REMOTE_STILL_POLLS = 2;
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
    script.addEventListener('error', () => {
      sdkPromise = null;
      reject(new Error(i18n.t('sdk.loadFailed', { ns: 'player' })));
    });
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
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  // Following playback outside the browser: (re)started by `followToken`, ended by `followStopped`.
  const [followToken, setFollowToken] = useState(0);
  const [followStopped, setFollowStopped] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const followRef = useRef<{ entry: RemoteEpisode; lastPositionMs: number; still: number } | null>(null);

  const startFollowing = useCallback(() => {
    setFollowStopped(false);
    setFollowToken((n) => n + 1);
  }, []);

  /**
   * Reads a remembered episode back from Spotify. A paused player bar showing
   * it takes over its resume point: Spotify often reports no playback at all
   * for an app paused in the background, so the last poll may be long out of
   * date. Once Spotify reports the episode as heard, it is forgotten and the
   * player bar shows it as completed.
   */
  const refreshRemote = useCallback(async (entry: RemoteEpisode) => {
    try {
      const view = await api.refreshEpisode(entry.showId, entry.episodeId);
      const completed = view.status === 'COMPLETED';
      setNowPlaying((cur) => {
        if (cur?.episodeId !== entry.episodeId || cur.target.kind === 'browser') return cur;
        const positionMs = cur.paused && !completed ? view.durationMs - view.remainingMs : cur.positionMs;
        return { ...cur, positionMs, completed: cur.completed || completed };
      });
      if (completed) forgetRemoteEpisode(entry.episodeId);
    } catch {
      // Spotify not reachable right now: the next visit tries again.
    }
  }, []);

  /** Catches up on all remembered episodes, e.g. when the user returns from the Spotify app. */
  const catchUp = useCallback(async () => {
    const remembered = loadRemoteEpisodes();
    if (!remembered.length) return;
    await Promise.all(remembered.map(refreshRemote));
    void invalidateRef.current();
  }, [refreshRemote]);

  const stopFollowing = useCallback(() => {
    setFollowStopped(true);
    const followed = followRef.current;
    followRef.current = null;
    setNowPlaying((cur) => (cur && cur.target.kind !== 'browser' ? { ...cur, paused: true } : cur));
    if (followed) void refreshRemote(followed.entry).then(() => invalidateRef.current());
  }, [refreshRemote]);

  // On start and whenever the page becomes visible again: catch up, then follow outside playback.
  useEffect(() => {
    const onVisibility = () => {
      const isVisible = document.visibilityState === 'visible';
      setVisible(isVisible);
      if (!isVisible) return;
      void catchUp();
      startFollowing();
    };
    void catchUp();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [catchUp, startFollowing]);

  // While visible, poll what Spotify plays; follow it if it is a remembered episode.
  useEffect(() => {
    if (followStopped || !visible || !loadRemoteEpisodes().length) return;
    let cancelled = false;
    const poll = async () => {
      const remembered = loadRemoteEpisodes();
      const cur = nowRef.current;
      if (!remembered.length || (cur?.target.kind === 'browser' && !cur.paused)) return stopFollowing();
      let state: PlaybackState | null;
      try {
        state = await api.playerState();
      } catch {
        return;
      }
      if (cancelled) return;
      const entry = state && remembered.find((r) => r.episodeId === state.episodeId);
      if (!state || !entry) {
        // Right after starting, Spotify may not report the new playback yet.
        const latest = remembered[0];
        const justStarted = !!latest && Date.now() - latest.startedAt < 2 * REMOTE_POLL_MS;
        return justStarted ? undefined : stopFollowing();
      }
      const prev = followRef.current?.entry.episodeId === entry.episodeId ? followRef.current : null;
      const moved = !state.paused && state.positionMs !== prev?.lastPositionMs;
      const still = moved ? 0 : (prev?.still ?? 0) + 1;
      followRef.current = { entry, lastPositionMs: state.positionMs, still };
      const { positionMs, paused, deviceName } = state;
      setNowPlaying((shown) => ({
        showId: entry.showId,
        episodeId: entry.episodeId,
        name: entry.name,
        showName: entry.showName,
        imageUrl: entry.imageUrl,
        durationMs: entry.durationMs,
        positionMs,
        paused,
        target: entry.target,
        deviceName,
        completed: shown?.episodeId === entry.episodeId && shown.completed,
      }));
      if (still >= REMOTE_STILL_POLLS) stopFollowing();
    };
    void poll();
    const timer = setInterval(() => void poll(), REMOTE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [followToken, followStopped, visible, stopFollowing]);

  const setTarget = useCallback((t: PlayTarget) => {
    setTargetState(t);
    try {
      localStorage.setItem(TARGET_KEY, JSON.stringify(t));
    } catch {
      // ignore
    }
  }, []);

  const discardPlayer = useCallback((player: Spotify.Player) => {
    player.disconnect();
    if (playerRef.current === player) playerRef.current = null;
    deviceRef.current = null;
  }, []);

  /** Creates the in-browser Spotify device once and resolves with its id. */
  const ensureBrowserDevice = useCallback((): Promise<string> => {
    if (deviceRef.current) return deviceRef.current;
    deviceRef.current = (async () => {
      await loadSdk();
      const player = new window.Spotify.Player({
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
      // An offline device is replaced by a new player on the next play; two
      // connected players would show up as two devices and report twice.
      player.addListener('not_ready', () => discardPlayer(player));
      player.addListener('player_state_changed', (state) => {
        const cur = nowRef.current;
        if (!state || !cur || cur.target.kind !== 'browser') return;
        setNowPlaying(applySdkState(cur, state));
      });
      return deviceId;
    })();
    deviceRef.current.catch(() => {
      if (playerRef.current) discardPlayer(playerRef.current);
      deviceRef.current = null;
    });
    return deviceRef.current;
  }, [toast, discardPlayer]);

  const play = useCallback(
    async (item: PlayableItem, opts: PlayOptions = {}) => {
      const t = target.kind === 'browser' && !browserSupported ? ({ kind: 'app' } as PlayTarget) : target;
      if (t.kind === 'app') {
        rememberRemoteEpisode(remoteEpisode(item, t));
        startFollowing();
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
        // Played here, it is no longer playback outside the browser to follow.
        if (t.kind === 'browser') forgetRemoteEpisode(item.episode.id);
        if (t.kind === 'device') {
          rememberRemoteEpisode(remoteEpisode(item, t));
          startFollowing();
          toast({ message: i18n.t('playingOn', { ns: 'player', device: t.name }) });
        }
      } catch (e) {
        if (t.kind === 'device' && e instanceof ApiError && e.code === 'device_unavailable') {
          toast({
            message: i18n.t('target.unavailable', { ns: 'player', device: t.name }),
            tone: 'error',
            action: {
              label: LISTEN_ON_SPOTIFY,
              onClick: () => window.open(item.episode.spotifyUrl, '_blank', 'noopener'),
            },
          });
        } else {
          toast({ message: (e as Error).message, tone: 'error' });
        }
      } finally {
        setBusy(false);
      }
    },
    [target, browserSupported, ensureBrowserDevice, toast, startFollowing],
  );

  // Poll the browser player while it plays; a reading that fails is simply taken a second later.
  const pollingEpisode =
    nowPlaying && !nowPlaying.paused && nowPlaying.target.kind === 'browser' ? nowPlaying.episodeId : null;
  useEffect(() => {
    if (!pollingEpisode) return;
    const timer = setInterval(() => {
      void playerRef.current?.getCurrentState().then(
        (state) => {
          if (state) setNowPlaying((cur) => (cur ? applySdkState(cur, state) : cur));
        },
        () => undefined,
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [pollingEpisode]);

  // Auto-complete once an episode has ended (see playbackEnded). The browser
  // player reports its position every second; outside the browser it is only
  // known at each poll, so the last position seen before the end may be up to
  // one poll away from it.
  const shownRef = useRef<NowPlaying | null>(null);
  const autoCompleteRef = useRef(false);
  autoCompleteRef.current = !!settings?.autoCompleteInPlayer;
  useEffect(() => {
    const prev = shownRef.current;
    shownRef.current = nowPlaying;
    if (!prev || !autoCompleteRef.current) return;
    const endWindowMs = prev.target.kind === 'browser' ? BROWSER_END_WINDOW_MS : REMOTE_POLL_MS + 15_000;
    if (!playbackEnded(prev, nowPlaying, endWindowMs)) return;
    setNowPlaying((cur) => (cur?.episodeId === prev.episodeId ? { ...cur, completed: true } : cur));
    forgetRemoteEpisode(prev.episodeId);
    api
      .setStatus(prev.showId, prev.episodeId, 'COMPLETED')
      .then(() => {
        void invalidateRef.current();
        toast({
          message: i18n.t('episode.autoCompleted', { name: prev.name }),
          tone: 'success',
          action: {
            label: i18n.t('episode.undo'),
            onClick: () => void api.setStatus(prev.showId, prev.episodeId, null).then(() => invalidateRef.current()),
          },
        });
      })
      .catch(() => undefined);
  }, [nowPlaying, toast]);

  const togglePause = useCallback(() => {
    const cur = nowRef.current;
    if (!cur) return;
    void playerRef.current?.togglePlay();
    setNowPlaying({ ...cur, paused: !cur.paused });
  }, []);

  const seekTo = useCallback((ms: number) => {
    const cur = nowRef.current;
    if (!cur) return;
    const pos = Math.max(0, Math.min(cur.durationMs - 1000, ms));
    void playerRef.current?.seek(pos);
    setNowPlaying({ ...cur, positionMs: pos });
  }, []);

  const seekBy = useCallback((delta: number) => seekTo((nowRef.current?.positionMs ?? 0) + delta), [seekTo]);

  const markCompleted = useCallback((episodeId: string) => {
    setNowPlaying((cur) => (cur?.episodeId === episodeId ? { ...cur, completed: true } : cur));
    forgetRemoteEpisode(episodeId);
  }, []);

  /** Closes the player bar; for playback outside the browser it also stops following that episode. */
  const close = useCallback(() => {
    const cur = nowRef.current;
    if (cur?.target.kind === 'browser') void playerRef.current?.pause();
    else if (cur) {
      forgetRemoteEpisode(cur.episodeId);
      followRef.current = null;
      setFollowStopped(true);
    }
    setNowPlaying(null);
  }, []);

  const value = useMemo(
    () => ({
      target,
      setTarget,
      browserSupported,
      nowPlaying,
      busy,
      play,
      togglePause,
      seekBy,
      seekTo,
      markCompleted,
      close,
    }),
    [target, setTarget, browserSupported, nowPlaying, busy, play, togglePause, seekBy, seekTo, markCompleted, close],
  );
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer outside PlayerProvider');
  return ctx;
}
