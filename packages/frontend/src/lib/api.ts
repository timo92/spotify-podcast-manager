import {
  ERROR_PARAMS,
  type ApiErrorBody,
  type AppStatus,
  type ErrorCode,
  type EpisodeNote,
  type NoteCreate,
  type NotePatch,
  type Schedule,
  type ScheduleSave,
  type WeekResponse,
  type EpisodeProgress,
  type EpisodeStatus,
  type EpisodeView,
  type PlaybackState,
  type PlayerDevice,
  type Settings,
  type Show,
  type ShowDetailResponse,
  type ShowSettingsPatch,
  type SyncState,
  type TodayResponse,
} from '@podcast/shared';
import i18n from '../i18n';

/** An error response as received; a newer server may send a code this build doesn't know. */
type ErrorResponse = Partial<Omit<ApiErrorBody, 'error' | 'params'>> & { error?: string; params?: object };

const isErrorCode = (code: string | undefined): code is ErrorCode => !!code && Object.hasOwn(ERROR_PARAMS, code);

/** The error in the active language; codes the app doesn't know keep the server's (German) message. */
export function errorMessage(body: ErrorResponse | undefined, status: number): string {
  const code = body?.error;
  if (isErrorCode(code)) return i18n.t(code, { ns: 'errors', ...body?.params });
  return body?.message ?? i18n.t('http', { ns: 'errors', status });
}

/** A failed API call; `message` is already translated (errorMessage). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The server couldn't be reached (offline, DNS, dropped connection); `message`
 * is translated. Unlike an `ApiError`, queries retry it like a server error.
 */
export class NetworkError extends Error {}

type NoteRef = Pick<EpisodeNote, 'showId' | 'episodeId' | 'id'>;

function notesPath(showId: string, episodeId: string) {
  return `/api/shows/${encodeURIComponent(showId)}/episodes/${encodeURIComponent(episodeId)}/notes`;
}

/** The parsed body; undefined for an empty one or one that isn't JSON (e.g. a proxy's HTML error page). */
function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch (e) {
    // fetch rejects with a TypeError when no response arrives; its text is the browser's own, in English.
    if (e instanceof TypeError) throw new NetworkError(i18n.t('ui.noConnection'), { cause: e });
    throw e;
  }
  const text = await res.text();
  const data = parseJson(text);
  if (!res.ok) {
    const error = data as ErrorResponse | undefined;
    throw new ApiError(res.status, error?.error ?? 'error', errorMessage(error, res.status));
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
  /** Re-reads the episode from Spotify (resume point) and returns it as the app shows it. */
  refreshEpisode: (showId: string, episodeId: string) =>
    request<EpisodeView>(
      'POST',
      `/api/shows/${encodeURIComponent(showId)}/episodes/${encodeURIComponent(episodeId)}/refresh`,
    ),
  setStatus: (showId: string, episodeId: string, status: EpisodeStatus | null) =>
    request<Show>('PUT', `/api/shows/${encodeURIComponent(showId)}/episodes/${encodeURIComponent(episodeId)}/status`, {
      status,
    }),
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
  playerState: () => request<PlaybackState | null>('GET', '/api/player/state'),
  pausePlayback: () => request<{ ok: true }>('POST', '/api/player/pause', {}),
  play: (input: { showId: string; episodeId: string; deviceId?: string; fromStart?: boolean; positionMs?: number }) =>
    // The time zone decides which day's Today fills the "Up next" playlist.
    request<{ ok: true; positionMs: number; durationMs: number }>('POST', '/api/player/play', {
      ...input,
      tz: TIME_ZONE,
    }),
  /** The "Up next" playlist, if the setting is on and it was written already. */
  upNextPlaylist: () => request<{ playlistId: string | null }>('GET', '/api/player/up-next'),
  /** Puts an episode about to be started in the Spotify app first in the "Up next" playlist. */
  prepareUpNext: (input: { showId: string; episodeId: string }) =>
    request<{ playlistId: string | null }>('POST', '/api/player/up-next', { ...input, tz: TIME_ZONE }),

  schedule: () => request<Schedule>('GET', '/api/schedule'),
  saveSchedule: (schedule: ScheduleSave) => request<Schedule>('PUT', '/api/schedule', schedule),
  week: () => request<WeekResponse>('GET', `/api/week?tz=${encodeURIComponent(TIME_ZONE)}`),

  notes: () => request<EpisodeNote[]>('GET', '/api/notes'),
  episodeNotes: (showId: string, episodeId: string) => request<EpisodeNote[]>('GET', notesPath(showId, episodeId)),
  createNote: (showId: string, episodeId: string, note: NoteCreate) =>
    request<EpisodeNote>('POST', notesPath(showId, episodeId), note),
  updateNote: (note: NoteRef, patch: NotePatch) =>
    request<EpisodeNote>('PATCH', `${notesPath(note.showId, note.episodeId)}/${encodeURIComponent(note.id)}`, patch),
  deleteNote: (note: NoteRef) =>
    request<{ ok: true }>('DELETE', `${notesPath(note.showId, note.episodeId)}/${encodeURIComponent(note.id)}`),

  deleteAll: () => request('DELETE', '/api/data'),
};
