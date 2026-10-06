import {
  CONSUMPTION_MODES,
  retentionExpiry,
  type ConsumptionMode,
  type DayPart,
  type EpisodeStatus,
  type Show,
  type TodayLabel,
  type Weekday,
} from '@podcast/shared';
import type { SyncState } from '@podcast/shared';
import i18n, { formatLocale } from '../i18n';
import type { resources } from '../i18n/resources';
import { errorMessage } from './api';

const t = i18n.t.bind(i18n);

/** Intl.DateTimeFormat for the active locale (cached per locale and options). */
const formatters = new Map<string, Intl.DateTimeFormat>();
function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = formatLocale();
  const key = `${locale} ${JSON.stringify(options)}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, fmt);
  }
  return fmt;
}

/** "12:03 / 45:00", the position in an episode as the player shows it. */
export const formatPosition = (positionMs: number, durationMs: number) =>
  `${formatClock(positionMs)} / ${formatClock(durationMs)}`;

export function formatDuration(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60_000));
  if (totalMin < 60) return t('duration.minutes', { minutes: totalMin });
  const hours = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m
    ? t('duration.hoursMinutes', { hours, minutes: String(m).padStart(2, '0') })
    : t('duration.hours', { hours });
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/** "12:34", "75:00" or "1:02:03" in ms; undefined if it isn't such a time. */
export function parseClock(text: string): number | undefined {
  const m = /^(?:(\d+):)?(\d+):(\d{2})$/.exec(text.trim());
  if (!m || Number(m[3]) > 59 || (m[1] !== undefined && Number(m[2]) > 59)) return undefined;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Spotify release dates are calendar dates (no time zone). */
export function formatReleaseDate(date: string, now = new Date()): string {
  if (!date) return '';
  const [y, m = '1', d = '1'] = date.split('-');
  const value = new Date(Number(y), Number(m) - 1, Number(d));
  const days = Math.round((startOfDay(now) - value.getTime()) / 86_400_000);
  if (days === 0) return t('time.today');
  if (days === 1) return t('time.yesterday');
  if ((days > 1 && days < 7) || value.getFullYear() === now.getFullYear()) {
    return dateFormat({ weekday: 'short', day: 'numeric', month: 'short' }).format(value);
  }
  return dateFormat({ day: 'numeric', month: 'short', year: 'numeric' }).format(value);
}

export function formatRelative(iso: string | undefined, now = Date.now()): string {
  if (!iso) return t('time.never');
  const diff = Math.round((now - Date.parse(iso)) / 1000);
  if (diff < 60) return t('time.justNow');
  if (diff < 3600) return t('time.minutesAgo', { count: Math.floor(diff / 60) });
  if (diff < 86_400) return t('time.hoursAgo', { count: Math.floor(diff / 3600) });
  const days = Math.floor(diff / 86_400);
  return days === 1 ? t('time.yesterdayInline') : t('time.daysAgo', { count: days });
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '';
  return dateFormat({ dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export const modeLabel = (mode: ConsumptionMode) => t(`mode.${mode}`);
export const modeHint = (mode: ConsumptionMode) => t(`modeHint.${mode}`);

type ProgressKey = keyof (typeof resources)['de']['shows']['progress'];

/** The modes as options of a Segmented control, in the active language. */
export const modeOptions = () => CONSUMPTION_MODES.map((m) => ({ value: m, label: modeLabel(m), hint: modeHint(m) }));

export function progressText(show: Show): { text: string; tone?: 'new' | 'muted' } {
  const progress = (key: ProgressKey, values?: Record<string, number>) =>
    t(`progress.${key}`, { ns: 'shows', ...values });
  const s = show.summary;
  if (!s || s.total === 0) return { text: progress('noEpisodes'), tone: 'muted' };
  const next = s.nextEpisode;
  if (show.pinnedEpisodeId && next?.id === show.pinnedEpisodeId) {
    return { text: progress('chosen', { index: next.index, total: s.total }) };
  }
  switch (show.mode) {
    case 'LATEST':
      if (!next) return { text: progress('noNew'), tone: 'muted' };
      return next.isNew ? { text: progress('newAvailable'), tone: 'new' } : { text: progress('newestOpen') };
    case 'SEQUENTIAL':
      if (!next) return { text: progress('allDone', { total: s.total }), tone: 'muted' };
      return { text: t('episode.ofTotal', { index: next.index, total: s.total }) };
    default:
      return { text: progress('noneChosen'), tone: 'muted' };
  }
}
export const statusLabel = (status: EpisodeStatus) => t(`status.${status}`);
export const todayLabel = (label: TodayLabel) => t(`todayLabel.${label}`);
export const dayPartLabel = (part: DayPart) => t(`dayPart.${part}`);
export const weekdayShort = (day: Weekday) => t(`weekdayShort.${day}`);
export const weekdayLong = (day: Weekday) => t(`weekdayLong.${day}`);

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return t('greeting.night');
  if (h < 11) return t('greeting.morning');
  if (h < 18) return t('greeting.day');
  return t('greeting.evening');
}

/** "Mo–Fr", "Mo, Mi, Fr", "Mo–Mi, Sa": runs of three or more days become a range. */
export function formatWeekdays(days: Weekday[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  const runs: Weekday[][] = [];
  for (const d of sorted) {
    const run = runs.at(-1);
    if (run && run[run.length - 1] === d - 1) run.push(d);
    else runs.push([d]);
  }
  return runs
    .flatMap((run) => {
      const first = run[0];
      const last = run.at(-1);
      return run.length >= 3 && first && last
        ? [`${weekdayShort(first)}–${weekdayShort(last)}`]
        : run.map((d) => weekdayShort(d));
    })
    .join(', ');
}

/** "Montag, 5. Oktober" / "Monday 5 October". */
export function formatLongDate(date: Date): string {
  return dateFormat({ weekday: 'long', day: 'numeric', month: 'long' }).format(date);
}

/** "Mo–Fr · Morgens": a plan rule's weekdays and part of day. */
export function formatRule(rule: { weekdays: Weekday[]; part: DayPart }): string {
  return `${formatWeekdays(rule.weekdays)} · ${dayPartLabel(rule.part)}`;
}

/** "5. Okt." / "5 Oct" for a YYYY-MM-DD calendar date. */
export function formatDayMonth(date: string): string {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number);
  return dateFormat({ day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
}

const TIMESTAMP_RE = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]/g;

/** Splits note text into plain parts and "[mm:ss]" / "[h:mm:ss]" timestamps (in ms). */
export function splitTimestamps(text: string): ({ text: string } | { label: string; ms: number })[] {
  const parts: ({ text: string } | { label: string; ms: number })[] = [];
  let last = 0;
  for (const m of text.matchAll(TIMESTAMP_RE)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    const ms = ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
    parts.push({ label: m[0], ms });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** The day on which data marked at `since` (unfollowed, disconnected) is deleted. */
export function formatDeletionDate(since: string): string {
  return dateFormat({ day: 'numeric', month: 'long', year: 'numeric' }).format(retentionExpiry(since));
}

/** Why a sync failed, translated when its error has a known code. */
export function syncError(sync: SyncState): string {
  if (sync.errorCode) return errorMessage({ error: sync.errorCode, params: sync.errorParams, message: sync.error }, 0);
  return sync.error ?? '';
}

/** What the running or last sync does or did; undefined before the first one. */
export function syncText(sync: SyncState | undefined): string | undefined {
  if (!sync) return undefined;
  if (sync.status === 'running') return t(sync.showId ? 'sync.reloadingShow' : 'sync.running');
  if (sync.status === 'error') return t('sync.failed', { error: syncError(sync) });
  if (sync.showsSynced === undefined) return undefined;
  return sync.showsFailed
    ? t('sync.doneWithErrors', { count: sync.showsSynced, failed: sync.showsFailed })
    : t('sync.done', { count: sync.showsSynced, newEpisodes: sync.newEpisodes ?? 0 });
}
