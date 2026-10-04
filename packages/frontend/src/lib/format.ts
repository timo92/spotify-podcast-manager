import type { ConsumptionMode, EpisodeStatus, TodayLabel } from '@podcast/shared';

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
