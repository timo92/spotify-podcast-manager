import { useEffect, useRef, type Dispatch } from 'react';
import i18n from '../../i18n';
import { api } from '../api';
import { playbackEnded } from '../playback-end';
import { useInvalidateLibrary, useSettings } from '../queries';
import { forgetRemoteEpisode } from '../remote-episodes';
import { useToast } from '../toast';
import type { NowPlaying, NowPlayingEvent } from './now-playing';
import { REMOTE_END_WINDOW_MS } from './remote-follow';

/** How close to its end the browser player must have been for an episode to count as ended. */
const BROWSER_END_WINDOW_MS = 5_000;

/**
 * Whether the change of the shown episode from `prev` to `next` ended `prev`
 * (see playbackEnded). The browser player reports its position every second;
 * outside the browser it is only known at each poll.
 */
export function shouldAutoComplete(prev: NowPlaying | null, next: NowPlaying | null): boolean {
  if (!prev) return false;
  return playbackEnded(prev, next, prev.target.kind === 'browser' ? BROWSER_END_WINDOW_MS : REMOTE_END_WINDOW_MS);
}

/**
 * Marks the shown episode as heard once its playback ended, if the user turned
 * that on; a toast offers to undo it.
 */
export function useAutoComplete(nowPlaying: NowPlaying | null, dispatch: Dispatch<NowPlayingEvent>) {
  const { data: settings } = useSettings();
  const toast = useToast();
  const invalidate = useInvalidateLibrary();
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  const enabledRef = useRef(false);
  enabledRef.current = !!settings?.autoCompleteInPlayer;
  const shownRef = useRef<NowPlaying | null>(null);

  useEffect(() => {
    const prev = shownRef.current;
    shownRef.current = nowPlaying;
    if (!prev || !enabledRef.current || !shouldAutoComplete(prev, nowPlaying)) return;
    const { showId, episodeId, name } = prev;
    dispatch({ type: 'marked', episodeId, completed: true });
    forgetRemoteEpisode(episodeId);
    api
      .setStatus(showId, episodeId, 'COMPLETED')
      .then(() => {
        void invalidateRef.current();
        toast({
          message: i18n.t('episode.autoCompleted', { name }),
          tone: 'success',
          action: {
            label: i18n.t('episode.undo'),
            onClick: () =>
              void api
                .setStatus(showId, episodeId, null)
                .then(() => invalidateRef.current())
                .catch((e: Error) => toast({ message: e.message, tone: 'error' })),
          },
        });
      })
      .catch((e: Error) => {
        dispatch({ type: 'marked', episodeId, completed: false });
        toast({ message: e.message, tone: 'error' });
      });
  }, [nowPlaying, dispatch, toast]);
}
