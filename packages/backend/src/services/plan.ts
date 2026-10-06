import { randomUUID } from 'node:crypto';
import {
  buildWeek,
  DAY_PARTS,
  localDate,
  type DayPart,
  type PlanDay,
  type PlanInput,
  type Schedule,
  type ScheduleRule,
  type Weekday,
} from '@podcast/shared';
import { StatusCodes } from 'http-status-codes';
import { ApiError, badRequest } from '../errors.js';
import type { Store } from '../store/types.js';
import type { LibraryService } from './library.js';

const MAX_RULES = 200;

export function validTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    // oxlint-disable-next-line eslint/no-new -- the constructor throws for an unknown time zone
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Distinct weekdays, ascending; at least one. */
function parseWeekdays(value: unknown): Weekday[] {
  if (!Array.isArray(value) || value.length === 0) throw badRequest('weekdays_required', 'Mindestens ein Wochentag');
  const days = value.map(Number);
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7))
    throw badRequest('invalid_weekday', 'Ungültiger Wochentag');
  return [...new Set(days)].sort((a, b) => a - b) as Weekday[];
}

/** Weekly plan: recurring rules, projected onto concrete episodes. */
export class PlanService {
  constructor(
    private readonly store: Store,
    private readonly library: LibraryService,
  ) {}

  /**
   * Validates and stores the whole plan. Rules without a unique id get a new
   * one. With `expectedUpdatedAt` (see ScheduleSave), a plan that changed in
   * the meantime is not overwritten: the save fails with `schedule_conflict`.
   */
  async saveSchedule(input: unknown): Promise<Schedule> {
    const body = input as { rules?: unknown; expectedUpdatedAt?: unknown } | null;
    const raw = body?.rules;
    if (!Array.isArray(raw)) throw badRequest('invalid_schedule', 'rules muss eine Liste sein');
    if (raw.length > MAX_RULES) throw badRequest('too_many_rules', `Höchstens ${MAX_RULES} Regeln`, { max: MAX_RULES });
    const shows = new Set((await this.store.listShows()).map((s) => s.id));
    const ids = new Set<string>();
    const rules: ScheduleRule[] = raw
      .map((r: Partial<ScheduleRule> | null) => {
        if (typeof r?.showId !== 'string' || !r.showId) throw badRequest('rule_show_missing', 'Podcast fehlt im Plan');
        const weekdays = parseWeekdays(r.weekdays);
        const part = (DAY_PARTS.includes(r.part as DayPart) ? r.part : 'ANYTIME') as DayPart;
        let id = typeof r.id === 'string' ? r.id.slice(0, 64) : '';
        if (!id || ids.has(id)) id = randomUUID();
        ids.add(id);
        return { id, showId: r.showId, weekdays, part };
      })
      // A plan loaded before a podcast was deleted (retention) may still contain
      // it; its rules are dropped instead of rejecting the whole save.
      .filter((r) => shows.has(r.showId));
    const expected =
      body && 'expectedUpdatedAt' in body
        ? typeof body.expectedUpdatedAt === 'string'
          ? body.expectedUpdatedAt
          : null
        : undefined;
    const schedule = { rules, updatedAt: new Date().toISOString() };
    if (!(await this.store.putSchedule(schedule, expected))) {
      throw new ApiError(StatusCodes.CONFLICT, 'schedule_conflict', 'Der Wochenplan wurde inzwischen geändert.');
    }
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
    const showIds = [...new Set(schedule.rules.map((r) => r.showId))];

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
