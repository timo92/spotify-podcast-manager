import type { NowPlaying } from './player';

/** A position this close to the start counts as "back at the beginning" (Spotify resets to 0 when an episode ends). */
const RESTART_MS = 5_000;

/**
 * Whether playback of `prev` ended with the change to `next`, so the episode
 * can count as heard. Spotify reports no "finished" event, so an end is
 * inferred: `prev` was playing within `endWindowMs` of the end, and then
 * playback stopped, moved on to something else, went back to the beginning,
 * or sits at the very end. Closing the player bar (`next` null) or seeking
 * back somewhere in the episode is not an end.
 */
export function playbackEnded(prev: NowPlaying | null, next: NowPlaying | null, endWindowMs: number): boolean {
  if (!prev || !next || prev.paused || prev.completed || prev.durationMs <= 0) return false;
  if (next.episodeId === prev.episodeId && next.completed) return false;
  if (prev.durationMs - prev.positionMs > endWindowMs) return false;
  return (
    next.episodeId !== prev.episodeId ||
    next.paused ||
    next.positionMs < RESTART_MS ||
    next.positionMs >= next.durationMs - 1000
  );
}
