import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { EpisodeStatus, EpisodeView, Schedule, ScheduleRule } from '@podcast/shared';
import { api, ApiError } from './api';
import { qk, useInvalidateLibrary } from './queries';
import { useToast } from './toast';

type EpisodeRef = Pick<EpisodeView, 'id' | 'showId' | 'status' | 'statusSource'>;

export interface RunOptions {
  /** Confirmation shown once the change went through. */
  message?: string;
  /** Offered in the confirmation; a failed undo is reported too. */
  undo?: () => Promise<unknown>;
  /** Puts back what the page already showed when the change fails. */
  revert?: () => void;
  /** What to reload afterwards; everything derived from the library by default. */
  refresh?: () => Promise<unknown>;
}

/**
 * Runs a change with the app's usual feedback: reload, confirm (with undo), or
 * report the error and revert. Resolves to whether the change went through.
 */
export function useRun() {
  const { t } = useTranslation();
  const invalidate = useInvalidateLibrary();
  const toast = useToast();
  return useCallback(
    async (change: () => Promise<unknown>, { message, undo, revert, refresh = invalidate }: RunOptions = {}) => {
      const fail = (e: unknown) => toast({ message: e instanceof Error ? e.message : String(e), tone: 'error' });
      try {
        await change();
        await refresh();
      } catch (e) {
        revert?.();
        fail(e);
        return false;
      }
      if (message) {
        const action = undo && { label: t('episode.undo'), onClick: () => void undo().then(refresh).catch(fail) };
        toast({ message, tone: 'success', action });
      }
      return true;
    },
    [t, invalidate, toast],
  );
}

/** Episode mutations with toast feedback and undo. */
export function useEpisodeActions() {
  const { t } = useTranslation();
  const run = useRun();

  function restore(ep: EpisodeRef) {
    return () => api.setStatus(ep.showId, ep.id, ep.statusSource === 'local' ? ep.status : null);
  }

  return {
    setStatus: (ep: EpisodeRef, status: EpisodeStatus) =>
      run(() => api.setStatus(ep.showId, ep.id, status), { message: t(`episode.done.${status}`), undo: restore(ep) }),
    resetStatus: (ep: EpisodeRef) =>
      run(() => api.setStatus(ep.showId, ep.id, null), { message: t('episode.statusReset'), undo: restore(ep) }),
    completeBefore: (ep: EpisodeRef) =>
      run(() => api.completeBefore(ep.showId, ep.id), { message: t('episode.completedBefore') }),
    pin: (showId: string, episodeId: string | null, previous?: string | null) =>
      run(() => api.updateShow(showId, { pinnedEpisodeId: episodeId }), {
        message: episodeId ? t('episode.pinned') : t('episode.unpinned'),
        undo: () => api.updateShow(showId, { pinnedEpisodeId: previous ?? null }),
      }),
  };
}

/**
 * Saves an edit of the weekly plan and confirms it with `message`. `edit` is
 * applied to the plan the page shows, and the result is saved only if that is
 * still the stored plan. If the plan changed elsewhere in the meantime, the
 * edit is applied once more to the fresh plan; a second conflict is reported.
 */
export function useSaveSchedule() {
  const qc = useQueryClient();
  const invalidate = useInvalidateLibrary();
  const toast = useToast();
  return async (edit: (rules: ScheduleRule[]) => ScheduleRule[], message: string) => {
    const saveOn = (base: Schedule) =>
      api.saveSchedule({ rules: edit(base.rules), expectedUpdatedAt: base.updatedAt ?? null });
    const isConflict = (e: unknown) => e instanceof ApiError && e.code === 'schedule_conflict';
    try {
      let saved: Schedule;
      try {
        saved = await saveOn(qc.getQueryData<Schedule>(qk.schedule) ?? (await api.schedule()));
      } catch (e) {
        if (!isConflict(e)) throw e;
        saved = await saveOn(await qc.fetchQuery({ queryKey: qk.schedule, queryFn: api.schedule, staleTime: 0 }));
      }
      qc.setQueryData(qk.schedule, saved);
      await invalidate();
      toast({ message, tone: 'success' });
    } catch (e) {
      if (isConflict(e)) void qc.invalidateQueries({ queryKey: qk.schedule });
      toast({ message: (e as Error).message, tone: 'error' });
    }
  };
}
