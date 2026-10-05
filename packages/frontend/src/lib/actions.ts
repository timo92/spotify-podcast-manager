import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { EpisodeStatus, EpisodeView, ScheduleRule } from '@podcast/shared';
import { api } from './api';
import { qk, useInvalidateLibrary } from './queries';
import { useToast } from './toast';

type EpisodeRef = Pick<EpisodeView, 'id' | 'showId' | 'status' | 'statusSource'>;

/** Episode mutations with toast feedback and undo. */
export function useEpisodeActions() {
  const { t } = useTranslation();
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
              label: t('episode.undo'),
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
      run(() => api.setStatus(ep.showId, ep.id, status), t(`episode.done.${status}`), restore(ep)),
    resetStatus: (ep: EpisodeRef) =>
      run(() => api.setStatus(ep.showId, ep.id, null), t('episode.statusReset'), restore(ep)),
    completeBefore: (ep: EpisodeRef) =>
      run(() => api.completeBefore(ep.showId, ep.id), t('episode.completedBefore')),
    pin: (showId: string, episodeId: string | null, previous?: string | null) =>
      run(
        () => api.updateShow(showId, { pinnedEpisodeId: episodeId }),
        episodeId ? t('episode.pinned') : t('episode.unpinned'),
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
