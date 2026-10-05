import { useQueryClient } from '@tanstack/react-query';
import type { EpisodeStatus, EpisodeView, ScheduleRule } from '@podcast/shared';
import { api } from './api';
import { qk, useInvalidateLibrary } from './queries';
import { useToast } from './toast';

const DONE_MESSAGE: Record<EpisodeStatus, string> = {
  COMPLETED: 'Als gehört markiert',
  SKIPPED: 'Übersprungen',
  UNSEEN: 'Als ungehört markiert',
  IN_PROGRESS: 'Als begonnen markiert',
};

type EpisodeRef = Pick<EpisodeView, 'id' | 'showId' | 'status' | 'statusSource'>;

/** Episode mutations with toast feedback and undo. */
export function useEpisodeActions() {
  const invalidate = useInvalidateLibrary();
  const toast = useToast();

  async function run(fn: () => Promise<unknown>, message: string, undo?: () => Promise<unknown>) {
    try {
      await fn();
      await invalidate();
      toast({
        message,
        tone: 'success',
        action: undo
          ? {
              label: 'Rückgängig',
              onClick: () => {
                void undo()
                  .then(invalidate)
                  .catch((e: Error) => toast({ message: e.message, tone: 'error' }));
              },
            }
          : undefined,
      });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  }

  function restore(ep: EpisodeRef) {
    return () => api.setStatus(ep.showId, ep.id, ep.statusSource === 'local' ? ep.status : null);
  }

  return {
    setStatus: (ep: EpisodeRef, status: EpisodeStatus) =>
      run(() => api.setStatus(ep.showId, ep.id, status), DONE_MESSAGE[status], restore(ep)),
    resetStatus: (ep: EpisodeRef) =>
      run(() => api.setStatus(ep.showId, ep.id, null), 'Status zurückgesetzt – Spotify-Stand gilt', restore(ep)),
    completeBefore: (ep: EpisodeRef) =>
      run(() => api.completeBefore(ep.showId, ep.id), 'Alle früheren Folgen als gehört markiert'),
    pin: (showId: string, episodeId: string | null, previous?: string | null) =>
      run(
        () => api.updateShow(showId, { pinnedEpisodeId: episodeId }),
        episodeId ? 'Als nächste Folge festgelegt' : 'Auswahl aufgehoben',
        () => api.updateShow(showId, { pinnedEpisodeId: previous ?? null }),
      ),
  };
}

/** Saves the whole weekly plan, refreshes what depends on it and confirms with `message`. */
export function useSaveSchedule() {
  const qc = useQueryClient();
  const invalidate = useInvalidateLibrary();
  const toast = useToast();
  return async (rules: ScheduleRule[], message: string) => {
    try {
      const saved = await api.saveSchedule({ rules });
      qc.setQueryData(qk.schedule, saved);
      await invalidate();
      toast({ message, tone: 'success' });
    } catch (e) {
      toast({ message: (e as Error).message, tone: 'error' });
    }
  };
}
