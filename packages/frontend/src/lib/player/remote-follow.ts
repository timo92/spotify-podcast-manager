import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject } from 'react';
import type { PlaybackState } from '@podcast/shared';
import { api } from '../api';
import { useInvalidateLibrary } from '../queries';
import { forgetRemoteEpisode, loadRemoteEpisodes, type RemoteEpisode } from '../remote-episodes';
import type { NowPlaying, NowPlayingEvent, PlayableItem, PlayTarget } from './now-playing';

/** How often playback outside the browser is read from Spotify while the page is visible. */
export const REMOTE_POLL_MS = 30_000;
/** Polls without movement after which following outside playback stops (it was paused or ended). */
const REMOTE_STILL_POLLS = 2;

/** The episode to remember when `item` starts outside the browser. */
export function remoteEpisode(item: PlayableItem, target: PlayTarget, now = Date.now()): RemoteEpisode {
  return {
    showId: item.show.id,
    episodeId: item.episode.id,
    name: item.episode.name,
    showName: item.show.name,
    imageUrl: item.episode.imageUrl ?? item.show.imageUrl,
    durationMs: item.episode.durationMs,
    target,
    startedAt: now,
  };
}

/** What following outside playback keeps from one poll to the next. */
export interface Followed {
  entry: RemoteEpisode;
  lastPositionMs: number;
  /** Polls in a row in which the episode didn't move. */
  still: number;
}

export type FollowStep =
  /** Nothing to show yet: playback was started a moment ago and Spotify doesn't report it yet. */
  | { kind: 'wait' }
  /** No remembered episode is playing: stop following. */
  | { kind: 'stop' }
  /** Show `followed.entry` with Spotify's `state`; `stop` once it stood still for long enough. */
  | { kind: 'follow'; followed: Followed; state: PlaybackState; stop: boolean };

/**
 * One poll of what Spotify plays (`state`), applied to the remembered
 * episodes (newest first) and what the previous poll followed.
 */
export function followStep(
  prev: Followed | null,
  state: PlaybackState | null,
  remembered: RemoteEpisode[],
  now: number,
): FollowStep {
  const entry = state && remembered.find((r) => r.episodeId === state.episodeId);
  if (!state || !entry) {
    const latest = remembered[0];
    const justStarted = !!latest && now - latest.startedAt < 2 * REMOTE_POLL_MS;
    return justStarted ? { kind: 'wait' } : { kind: 'stop' };
  }
  const same = prev?.entry.episodeId === entry.episodeId ? prev : null;
  const moved = !state.paused && state.positionMs !== same?.lastPositionMs;
  const still = moved ? 0 : (same?.still ?? 0) + 1;
  return {
    kind: 'follow',
    followed: { entry, lastPositionMs: state.positionMs, still },
    state,
    stop: still >= REMOTE_STILL_POLLS,
  };
}

/** Controls for following playback outside the browser. */
export interface RemoteFollow {
  /** (Re)starts following, e.g. right after starting an episode outside the browser. */
  startFollowing: () => void;
  /** Stops following without reading the episode back, e.g. when the player bar is closed. */
  endFollowing: () => void;
}

/**
 * Follows playback outside the browser (Spotify app, Connect devices) for the
 * remembered episodes: catches up on them when the app starts and whenever the
 * page becomes visible again, then polls what Spotify plays while the page is
 * visible and shows it in the player bar until it stands still.
 */
export function useRemoteFollow(
  nowRef: RefObject<NowPlaying | null>,
  dispatch: Dispatch<NowPlayingEvent>,
): RemoteFollow {
  const invalidate = useInvalidateLibrary();
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  // (Re)started by `followToken`, ended by `stopped`.
  const [followToken, setFollowToken] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const followRef = useRef<Followed | null>(null);

  const startFollowing = useCallback(() => {
    setStopped(false);
    setFollowToken((n) => n + 1);
  }, []);

  const endFollowing = useCallback(() => {
    followRef.current = null;
    setStopped(true);
  }, []);

  /**
   * Reads a remembered episode back from Spotify. Once Spotify reports it as
   * heard, it is forgotten and the player bar shows it as completed.
   */
  const refreshRemote = useCallback(
    async (entry: RemoteEpisode) => {
      try {
        const view = await api.refreshEpisode(entry.showId, entry.episodeId);
        const completed = view.status === 'COMPLETED';
        dispatch({
          type: 'remoteRefreshed',
          episodeId: entry.episodeId,
          positionMs: view.durationMs - view.remainingMs,
          completed,
        });
        if (completed) forgetRemoteEpisode(entry.episodeId);
      } catch {
        // Spotify not reachable right now: the next visit tries again.
      }
    },
    [dispatch],
  );

  /** Catches up on all remembered episodes, e.g. when the user returns from the Spotify app. */
  const catchUp = useCallback(async () => {
    const remembered = loadRemoteEpisodes();
    if (!remembered.length) return;
    await Promise.all(remembered.map(refreshRemote));
    void invalidateRef.current();
  }, [refreshRemote]);

  const stopFollowing = useCallback(() => {
    setStopped(true);
    const followed = followRef.current;
    followRef.current = null;
    dispatch({ type: 'followStopped' });
    if (followed) void refreshRemote(followed.entry).then(() => invalidateRef.current());
  }, [dispatch, refreshRemote]);

  // On start and whenever the page becomes visible again: catch up, then follow.
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
    if (stopped || !visible || !loadRemoteEpisodes().length) return;
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
      const step = followStep(followRef.current, state, remembered, Date.now());
      if (step.kind === 'wait') return;
      if (step.kind === 'stop') return stopFollowing();
      followRef.current = step.followed;
      dispatch({ type: 'remotePoll', entry: step.followed.entry, state: step.state });
      if (step.stop) stopFollowing();
    };
    void poll();
    const timer = setInterval(() => void poll(), REMOTE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [followToken, stopped, visible, nowRef, dispatch, stopFollowing]);

  return { startFollowing, endFollowing };
}
