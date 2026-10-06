import { isDone, plannedOpenMs, selectNextEpisode, toShowLite } from './logic.js';
import {
  DAY_PARTS,
  type DayPart,
  type EpisodeView,
  type PlanDay,
  type PlannedItem,
  type Schedule,
  type ScheduleRule,
  type Show,
  type Weekday,
} from './types.js';

/** Calendar date (YYYY-MM-DD) of an instant in the given IANA time zone. */
export function localDate(instant: string | number | Date, timeZone: string): string {
  const d = new Date(instant);
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Year, month and day of a YYYY-MM-DD date. */
function dateParts(date: string): [number, number, number] {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number);
  return [y, m, d];
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = dateParts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): Weekday {
  const [y, m, d] = dateParts(date);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return (js === 0 ? 7 : js) as Weekday;
}

/**
 * The episodes a show will offer next, in order. For a series that is the
 * next episode followed by the open ones after it; news-like and manual
 * shows only ever have one known "next" episode.
 */
export function upcomingEpisodes(show: Show, views: EpisodeView[]): EpisodeView[] {
  const next = selectNextEpisode(show, views);
  if (!next) return [];
  if (show.mode !== 'SEQUENTIAL') return [next];
  const rest = views.filter(
    (v) => v.index > next.index && (v.status === 'UNSEEN' || v.status === 'IN_PROGRESS') && v.isPlayable !== false,
  );
  return [next, ...rest];
}

export interface PlanInput {
  show: Show;
  /** All episodes, oldest first (buildEpisodeViews). */
  views: EpisodeView[];
  /** Episodes of this show finished today, in the order they were finished. */
  doneToday: EpisodeView[];
}

/**
 * Projects the recurring weekly plan onto concrete days starting at `start`.
 *
 * Slots of a series consume its queue in order, so planning a series on
 * Monday and Wednesday shows episode n on Monday and n+1 on Wednesday. Manual
 * and news-like shows have only one next episode (for news, the newest one not
 * heard yet), which every slot shows until it is heard. On today, episodes
 * already finished today fill the slots
 * first – that's how a planned item turns into "done" instead of jumping to
 * the next episode.
 */
export function buildWeek(
  start: string,
  today: string,
  days: number,
  schedule: Schedule,
  inputs: Map<string, PlanInput>,
): PlanDay[] {
  const queues = new Map<string, EpisodeView[]>();
  const done = new Map<string, EpisodeView[]>();
  for (const [id, input] of inputs) {
    queues.set(id, upcomingEpisodes(input.show, input.views));
    done.set(
      id,
      input.doneToday.filter((e) => isDone(e.status)),
    );
  }
  const heads = new Map([...queues].map(([id, queue]) => [id, queue[0]?.id]));
  const order = (part: DayPart) => DAY_PARTS.indexOf(part);

  const result: PlanDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const weekday = weekdayOf(date);
    const isToday = date === today;
    // Past days of the range have no slots.
    const rules = (date < today ? [] : schedule.rules)
      .map((rule, idx) => ({ rule, idx }))
      // A podcast removed from the library is no longer suggested; its rules wait for retention.
      .filter(({ rule }) => rule.weekdays.includes(weekday) && inputs.get(rule.showId)?.show.followed)
      .sort((a, b) => order(a.rule.part) - order(b.rule.part) || a.idx - b.idx)
      .map(({ rule }) => rule);

    const items: PlannedItem[] = [];
    for (const rule of rules) {
      const input = inputs.get(rule.showId);
      if (!input) continue;
      const base = { ruleId: rule.id, part: rule.part, show: toShowLite(input.show), paused: input.show.paused };
      const doneEpisode = isToday ? done.get(rule.showId)?.shift() : undefined;
      if (doneEpisode) {
        items.push({ ...base, episode: doneEpisode, state: 'done' });
        continue;
      }
      const queue = queues.get(rule.showId) ?? [];
      const ep = (input.show.mode === 'SEQUENTIAL' ? queue.shift() : queue[0]) ?? null;
      if (!ep) {
        items.push({ ...base, episode: null, state: 'none' });
        continue;
      }
      items.push({ ...base, episode: ep, state: ep.id === heads.get(rule.showId) ? 'next' : 'upcoming' });
    }
    result.push({ date, weekday, isToday, items, openMs: plannedOpenMs(items) });
  }
  return result;
}

/** Replaces the rule with the same id. */
export function replaceRule(rules: ScheduleRule[], rule: ScheduleRule): ScheduleRule[] {
  return rules.map((r) => (r.id === rule.id ? rule : r));
}

/** Removes the whole rule, i.e. all of its slots. */
export function removeRule(rules: ScheduleRule[], ruleId: string): ScheduleRule[] {
  return rules.filter((r) => r.id !== ruleId);
}

/** Removes one weekday from a rule, and the rule once it has no weekday left. */
export function removeWeekday(rules: ScheduleRule[], ruleId: string, weekday: Weekday): ScheduleRule[] {
  return rules
    .map((r) => (r.id === ruleId ? { ...r, weekdays: r.weekdays.filter((d) => d !== weekday) } : r))
    .filter((r) => r.weekdays.length > 0);
}
