import { RETENTION_DAYS, type ConsumptionMode, type DayPart, type EpisodeStatus, type TodayLabel, type Weekday } from '@podcast/shared';

export function formatDuration(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60_000));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')} min` : `${h} h`;
}

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const fullFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Spotify release dates are calendar dates (no time zone). */
export function formatReleaseDate(date: string, now = new Date()): string {
  if (!date) return '';
  const [y, m = '1', d = '1'] = date.split('-');
  const value = new Date(Number(y), Number(m) - 1, Number(d));
  const days = Math.round((startOfDay(now) - value.getTime()) / 86_400_000);
  if (days === 0) return 'Heute';
  if (days === 1) return 'Gestern';
  if (days > 1 && days < 7) return dayFmt.format(value);
  if (value.getFullYear() === now.getFullYear()) return dayFmt.format(value);
  return fullFmt.format(value);
}

export function formatRelative(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'nie';
  const diff = Math.round((now - Date.parse(iso)) / 1000);
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} min`;
  if (diff < 86_400) return `vor ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86_400);
  return days === 1 ? 'gestern' : `vor ${days} Tagen`;
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

export const MODE_LABEL: Record<ConsumptionMode, string> = {
  LATEST: 'Aktualität',
  SEQUENTIAL: 'Reihenfolge',
  MANUAL: 'Frei',
};

export const MODE_HINT: Record<ConsumptionMode, string> = {
  LATEST: 'Immer die neueste Folge',
  SEQUENTIAL: 'Von vorne durcharbeiten',
  MANUAL: 'Du wählst die nächste Folge',
};

export const STATUS_LABEL: Record<EpisodeStatus, string> = {
  UNSEEN: 'Ungehört',
  IN_PROGRESS: 'Begonnen',
  COMPLETED: 'Gehört',
  SKIPPED: 'Übersprungen',
};

export const TODAY_LABEL: Record<TodayLabel, string> = {
  NEU: 'Neu',
  WEITER: 'Weiter',
  NAECHSTE: 'Nächste',
  GEWAEHLT: 'Gewählt',
};

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Gute Nacht';
  if (h < 11) return 'Guten Morgen';
  if (h < 18) return 'Guten Tag';
  return 'Guten Abend';
}

export const DAY_PART_LABEL: Record<DayPart, string> = {
  MORNING: 'Morgens',
  MIDDAY: 'Mittags',
  EVENING: 'Abends',
  ANYTIME: 'Jederzeit',
};

export const WEEKDAY_SHORT: Record<Weekday, string> = { 1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr', 6: 'Sa', 7: 'So' };

export const WEEKDAY_LONG: Record<Weekday, string> = {
  1: 'Montag',
  2: 'Dienstag',
  3: 'Mittwoch',
  4: 'Donnerstag',
  5: 'Freitag',
  6: 'Samstag',
  7: 'Sonntag',
};

/** "5. Okt." for a YYYY-MM-DD calendar date. */
export function formatDayMonth(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
}

const TIMESTAMP_RE = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]/g;

/** Splits note text into plain parts and "[mm:ss]" / "[h:mm:ss]" timestamps (in ms). */
export function splitTimestamps(text: string): ({ text: string } | { label: string; ms: number })[] {
  const parts: ({ text: string } | { label: string; ms: number })[] = [];
  let last = 0;
  for (const m of text.matchAll(TIMESTAMP_RE)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) });
    const ms = ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
    parts.push({ label: m[0], ms });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** Date on which data with the given start time is deleted (see RETENTION_DAYS). */
export function expiresAfterRetention(since: string): Date {
  return new Date(Date.parse(since) + RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}
