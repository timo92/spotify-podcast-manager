import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  note: (showId: string, episodeId: string) => ['note', showId, episodeId] as const,
};

const LIBRARY_KEYS = new Set(['today', 'shows', 'show', 'episode', 'history', 'week']);

export function useStatus() {
  return useQuery({
    queryKey: qk.status,
    queryFn: api.status,
    refetchInterval: (q) => (q.state.data?.sync?.status === 'running' ? 2000 : false),
  });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.settings, staleTime: 60_000 });
}

/** Refetch everything derived from shows/episodes/progress. */
export function useInvalidateLibrary() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: (q) => LIBRARY_KEYS.has(String(q.queryKey[0])) });
}
