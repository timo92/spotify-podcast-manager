import { randomUUID } from 'node:crypto';
import {
  buildWeek,
  DAY_PARTS,
  localDate,
  type DayPart,
  type PlanDay,
  type PlanInput,
  type Schedule,
  type ScheduleEntry,
} from '@podcast/shared';
import { badRequest } from '../errors.js';
import type { Store } from '../store/types.js';
import type { LibraryService } from './library.js';

const MAX_ENTRIES = 200;

export function validTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Weekly plan: recurring slots, projected onto concrete episodes. */
export class PlanService {
  constructor(
    private readonly store: Store,
    private readonly library: LibraryService,
  ) {}

  async saveSchedule(input: unknown): Promise<Schedule> {
    const raw = (input as { entries?: unknown })?.entries;
    if (!Array.isArray(raw)) throw badRequest('entries muss eine Liste sein');
    if (raw.length > MAX_ENTRIES) throw badRequest(`Höchstens ${MAX_ENTRIES} Einträge`);
    const shows = new Set((await this.store.listShows()).map((s) => s.id));
    const entries: ScheduleEntry[] = raw.map((e: Partial<ScheduleEntry>) => {
      const weekday = Number(e?.weekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw badRequest('Ungültiger Wochentag');
      if (!e?.showId || !shows.has(e.showId)) throw badRequest('Unbekannter Podcast im Plan');
      const part = (DAY_PARTS.includes(e.part as DayPart) ? e.part : 'ANYTIME') as DayPart;
      return {
        id: typeof e.id === 'string' && e.id ? e.id.slice(0, 64) : randomUUID(),
        showId: e.showId,
        weekday: weekday as ScheduleEntry['weekday'],
        part,
      };
    });
    const schedule = { entries, updatedAt: new Date().toISOString() };
    await this.store.putSchedule(schedule);
    return schedule;
  }

  /** Projects the plan for `days` days starting at `start` (defaults to today in `tz`). */
  async week(tz: string, days = 7, start?: string): Promise<PlanDay[]> {
    const today = localDate(Date.now(), tz);
    const from = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : today;
    const [schedule, settings, history] = await Promise.all([
      this.store.getSchedule(),
      this.store.getSettings(),
      this.store.listHistory(100),
    ]);
    const showIds = [...new Set(schedule.entries.map((e) => e.showId))];

    // Episodes finished today, oldest first, per show.
    const doneTodayIds = new Map<string, string[]>();
    for (const p of [...history].reverse()) {
      if (p.listenedAt && localDate(p.listenedAt, tz) === today) {
        doneTodayIds.set(p.showId, [...(doneTodayIds.get(p.showId) ?? []), p.episodeId]);
      }
    }

    const inputs = new Map<string, PlanInput>();
    await Promise.all(
      showIds.map(async (id) => {
        const show = await this.store.getShow(id);
        if (!show) return;
        const views = await this.library.loadViews(show, settings);
        const byId = new Map(views.map((v) => [v.id, v]));
        const doneToday = (doneTodayIds.get(id) ?? []).map((eid) => byId.get(eid)).filter((v) => !!v);
        inputs.set(id, { show, views, doneToday });
      }),
    );
    return buildWeek(from, today, Math.min(14, Math.max(1, days)), schedule, inputs);
  }
}
