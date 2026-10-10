import { createContext, useCallback, useContext, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import i18n from '../i18n';
import { LISTEN_ON_SPOTIFY } from '../components/SpotifyAttribution';
import { api, ApiError } from './api';
import { useAutoComplete } from './player/auto-complete';
import { nowPlayingReducer, type NowPlaying, type PlayableItem, type PlayTarget } from './player/now-playing';
import { remoteEpisode, useRemoteFollow } from './player/remote-follow';
import { detectBrowserSupport, useBrowserDevice, type BrowserDevice } from './player/sdk';
import { afterUpNext, upNextItem } from './player/up-next';
import { qk, useUpNextPlaylist } from './queries';
import { forgetRemoteEpisode, rememberRemoteEpisode } from './remote-episodes';
import { readStoredJson, writeStored } from './storage';
import { useToast } from './toast';

export {
  controlsInBrowser,
  deviceOf,
  playsInBrowser,
  type NowPlaying,
  type PlayableItem,
  type PlayTarget,
} from './player/now-playing';
export { BROWSER_DEVICE_NAME } from './player/sdk';

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
/** How far from its end the browser player may last have reported an episode that then ended (it reports every second). */
const BROWSER_END_SLACK_MS = 10_000;
/** How long a freshly created browser device may take until Spotify knows it. */
const NEW_DEVICE_RETRY_MS = 1500;

/**
 * Opens `item` in the Spotify app. With the "Up next" playlist in use, the
 * playlist opens instead, so Spotify continues with Today after the episode;
 * the episode is put first in it meanwhile. The link opens right away, as
 * browsers block links opened after waiting for a response. Without a
 * playlist yet, the episode opens, and the playlist is written for next time.
 */
function openInApp(
  item: PlayableItem,
  playlistId: string | null | undefined,
  onPrepared: (playlistId: string | null) => void,
) {
  window.open(
    playlistId ? `https://open.spotify.com/playlist/${playlistId}` : item.episode.spotifyUrl,
    '_blank',
    'noopener',
  );
  if (playlistId === undefined) return;
  api.prepareUpNext({ showId: item.show.id, episodeId: item.episode.id }).then(
    (res) => onPrepared(res.playlistId),
    // Without it the playlist still holds Today, just not this episode first.
    () => undefined,
  );
}

function loadTarget(fallback: PlayTarget): PlayTarget {
  return (readStoredJson(TARGET_KEY) as PlayTarget | undefined) ?? fallback;
}

/**
 * The player: where episodes are played, and the episode shown in the player
 * bar. The parts in `./player/` do the work: the browser device (sdk), playback
 * outside the browser (remote-follow) and auto-complete; every change of the
 * shown episode goes through `nowPlayingReducer`.
 */
export function PlayerProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [browserSupported] = useState(detectBrowserSupport);
  const [target, setTargetState] = useState<PlayTarget>(() =>
    loadTarget(browserSupported ? { kind: 'browser' } : { kind: 'app' }),
  );
  const [nowPlaying, dispatch] = useReducer(nowPlayingReducer, null);
  const [busy, setBusy] = useState(false);
  const nowRef = useRef<NowPlaying | null>(null);
  nowRef.current = nowPlaying;

  const deviceRef = useRef<BrowserDevice | null>(null);
  const checkedTrack = useRef<string | null>(null);
  const onSdkState = useCallback((state: Spotify.PlaybackState) => {
    const shown = nowRef.current;
    dispatch({ type: 'sdkState', state });
    // The browser player moved on by itself: the "Up next" playlist's next
    // episode, or Spotify's Autoplay. Only the API knows which one it is.
    const uri = state.track_window.current_track?.uri;
    if (shown?.target.kind !== 'browser' || !uri || uri === `spotify:episode:${shown.episodeId}`) return;
    if (checkedTrack.current === uri) return;
    checkedTrack.current = uri;
    const ended = shown.durationMs - shown.positionMs <= BROWSER_END_SLACK_MS;
    api.playerState().then(
      (playing) => {
        if (!playing || `spotify:episode:${playing.episodeId}` !== uri) return;
        const next = afterUpNext(playing, ended);
        const item = next === 'follow' ? upNextItem(playing) : undefined;
        if (item) {
          const { positionMs, durationMs } = playing;
          dispatch({ type: 'played', item, target: { kind: 'browser' }, positionMs, durationMs });
        } else if (next === 'pause') {
          deviceRef.current?.pause();
        }
      },
      () => undefined,
    );
  }, []);
  const device = useBrowserDevice(
    onSdkState,
    !!nowPlaying && !nowPlaying.paused && nowPlaying.target.kind === 'browser',
  );
  deviceRef.current = device;
  const { startFollowing, endFollowing } = useRemoteFollow(nowRef, dispatch);
  useAutoComplete(nowPlaying, dispatch);
  const queryClient = useQueryClient();
  const upNextPlaylist = useUpNextPlaylist();

  const setTarget = useCallback((t: PlayTarget) => {
    setTargetState(t);
    writeStored(TARGET_KEY, JSON.stringify(t));
  }, []);

  const play = useCallback(
    async (item: PlayableItem, opts: PlayOptions = {}) => {
      const t = target.kind === 'browser' && !browserSupported ? ({ kind: 'app' } as PlayTarget) : target;
      if (t.kind === 'app') {
        // The Spotify app plays on its own; a browser player still running would play along.
        if (nowRef.current?.target.kind === 'browser') {
          device.pause();
          dispatch({ type: 'closed' });
        }
        rememberRemoteEpisode(remoteEpisode(item, t));
        startFollowing();
        openInApp(item, upNextPlaylist, (playlistId) => queryClient.setQueryData(qk.upNext, { playlistId }));
        return;
      }
      device.activate();
      setBusy(true);
      try {
        const deviceId = t.kind === 'device' ? t.id : await device.ensureDevice();
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
          if (!(e instanceof ApiError) || e.status !== 404 || t.kind !== 'browser') throw e;
          await new Promise((r) => setTimeout(r, NEW_DEVICE_RETRY_MS));
          res = await api.play(request);
        }
        dispatch({ type: 'played', item, target: t, positionMs: res.positionMs, durationMs: res.durationMs });
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
    [target, browserSupported, device, toast, startFollowing, upNextPlaylist, queryClient],
  );

  const togglePause = useCallback(() => {
    if (!nowRef.current) return;
    device.togglePlay();
    dispatch({ type: 'toggled' });
  }, [device]);

  const seekTo = useCallback(
    (ms: number) => {
      const cur = nowRef.current;
      if (!cur) return;
      const positionMs = Math.max(0, Math.min(cur.durationMs - 1000, ms));
      device.seek(positionMs);
      dispatch({ type: 'seeked', positionMs });
    },
    [device],
  );

  const seekBy = useCallback((delta: number) => seekTo((nowRef.current?.positionMs ?? 0) + delta), [seekTo]);

  const markCompleted = useCallback((episodeId: string) => {
    dispatch({ type: 'marked', episodeId, completed: true });
    forgetRemoteEpisode(episodeId);
  }, []);

  /** Closes the player bar; for playback outside the browser it also stops following that episode. */
  const close = useCallback(() => {
    const cur = nowRef.current;
    if (cur?.target.kind === 'browser') device.pause();
    else if (cur) {
      forgetRemoteEpisode(cur.episodeId);
      endFollowing();
    }
    dispatch({ type: 'closed' });
  }, [device, endFollowing]);

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
