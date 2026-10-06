import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EpisodeView } from '@podcast/shared';
import { api } from './api';

export const qk = {
  status: ['status'] as const,
  today: ['today'] as const,
  shows: ['shows'] as const,
  show: (id: string) => ['show', id] as const,
  episode: (showId: string, episodeId: string) => ['episode', showId, episodeId] as const,
  settings: ['settings'] as const,
  history: ['history'] as const,
  devices: ['devices'] as const,
  schedule: ['schedule'] as const,
  week: ['week'] as const,
  notes: ['notes'] as const,
  /** Under `notes`, so invalidating all notes also refreshes each episode's. */
  episodeNotes: (showId: string, episodeId: string) => ['notes', showId, episodeId] as const,
};

const LIBRARY_KEYS = new Set(['today', 'shows', 'show', 'episode', 'history', 'week']);

export function useStatus() {
  return useQuery({
    queryKey: qk.status,
    queryFn: api.status,
    // Fast while a sync runs; otherwise once a minute, so the time since the last
    // sync stays current and scheduled syncs show up (paused in background tabs).
    refetchInterval: (q) => (q.state.data?.sync?.status === 'running' ? 2000 : 60_000),
  });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.settings, staleTime: 60_000 });
}

/**
 * Re-reads an episode from Spotify once when it is shown, so progress made in
 * the Spotify app or on another device appears without waiting for a sync.
 * Failures are ignored; the stored state stays.
 */
export function useRefreshFromSpotify(showId: string, episodeId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateLibrary();
  useEffect(() => {
    let active = true;
    api
      .refreshEpisode(showId, episodeId)
      .then(async (fresh) => {
        if (!active) return;
        const key = qk.episode(showId, episodeId);
        const shown = qc.getQueryData<EpisodeView>(key);
        // A load of the stored episode still in flight would overwrite the fresher state.
        await qc.cancelQueries({ queryKey: key });
        qc.setQueryData(key, fresh);
        if (shown && (shown.status !== fresh.status || shown.remainingMs !== fresh.remainingMs)) void invalidate();
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [showId, episodeId, qc, invalidate]);
}

/** Refetches everything derived from the library; the returned function is stable. */
export function useInvalidateLibrary() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ predicate: (q) => LIBRARY_KEYS.has(String(q.queryKey[0])) }), [qc]);
}
