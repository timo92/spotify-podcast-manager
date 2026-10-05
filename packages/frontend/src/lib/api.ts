import type {
  AppStatus,
  EpisodeNote,
  Schedule,
  WeekResponse,
  EpisodeProgress,
  EpisodeStatus,
  EpisodeView,
  PlayerDevice,
  Settings,
  Show,
  ShowDetailResponse,
  ShowSettingsPatch,
  SyncState,
  TodayResponse,
} from '@podcast/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? `Fehler ${res.status}`);
  }
  return data as T;
}

export type Status = AppStatus;

/** The browser's time zone – "today" and the weekly plan are computed in it. */
export const TIME_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

export const api = {
  status: () => request<Status>('GET', '/api/status'),
  setup: (input: { setupCode?: string; clientId: string; clientSecret: string }) =>
    request<{ ok: true; loginUrl: string }>('POST', '/api/setup', input),
  logout: () => request('POST', '/api/auth/logout'),

  today: () => request<TodayResponse>('GET', `/api/today?tz=${encodeURIComponent(TIME_ZONE)}`),
  history: (limit = 100) => request<EpisodeProgress[]>('GET', `/api/history?limit=${limit}`),

  shows: () => request<Show[]>('GET', '/api/shows'),
  show: (id: string) => request<ShowDetailResponse>('GET', `/api/shows/${encodeURIComponent(id)}`),
  updateShow: (id: string, patch: ShowSettingsPatch) =>
    request<Show>('PATCH', `/api/shows/${encodeURIComponent(id)}`, patch),
  reorder: (ids: string[]) => request('POST', '/api/shows/reorder', { ids }),
  syncShow: (id: string) => request<SyncState>('POST', `/api/shows/${encodeURIComponent(id)}/sync`),
  episode: (showId: string, episodeId: string) =>
    request<EpisodeView>('GET', `/api/shows/${encodeURIComponent(showId)}/episodes/${encodeURIComponent(episodeId)}`),
  setStatus: (showId: string, episodeId: string, status: EpisodeStatus | null) =>
    request<Show>(
      'PUT',
      `/api/shows/${encodeURIComponent(showId)}/episodes/${encodeURIComponent(episodeId)}/status`,
      { status },
    ),
  completeBefore: (showId: string, episodeId: string) =>
    request<Show>(
      'POST',
      `/api/shows/${encodeURIComponent(showId)}/episodes/${encodeURIComponent(episodeId)}/complete-before`,
    ),

  sync: (full = false) => request<SyncState>('POST', '/api/sync', { full }),

  settings: () => request<Settings>('GET', '/api/settings'),
  saveSettings: (s: Partial<Settings>) => request<Settings>('PUT', '/api/settings', s),

  playerToken: () => request<{ accessToken: string; expiresAt: number }>('GET', '/api/player/token'),
  devices: () => request<PlayerDevice[]>('GET', '/api/player/devices'),
  play: (input: { showId: string; episodeId: string; deviceId?: string; fromStart?: boolean; positionMs?: number }) =>
    request<{ ok: true; positionMs: number; durationMs: number }>('POST', '/api/player/play', input),

  schedule: () => request<Schedule>('GET', '/api/schedule'),
  saveSchedule: (schedule: Schedule) => request<Schedule>('PUT', '/api/schedule', schedule),
  week: () => request<WeekResponse>('GET', `/api/week?tz=${encodeURIComponent(TIME_ZONE)}`),

  notes: () => request<EpisodeNote[]>('GET', '/api/notes'),
  note: (showId: string, episodeId: string) =>
    request<EpisodeNote | null>(
      'GET',
      `/api/shows/${encodeURIComponent(showId)}/episodes/${encodeURIComponent(episodeId)}/note`,
    ),
  saveNote: (showId: string, episodeId: string, text: string) =>
    request<EpisodeNote | null>(
      'PUT',
      `/api/shows/${encodeURIComponent(showId)}/episodes/${encodeURIComponent(episodeId)}/note`,
      { text },
    ),

  deleteAll: () => request('DELETE', '/api/data'),
};
