import {
  DONE_STATUSES,
  type Episode,
  type EpisodeProgress,
  type EpisodeStatus,
  type EpisodeView,
  type HistoryItem,
  type PlannedItem,
  type Settings,
  type Show,
  type ShowLite,
  type ShowSummary,
  type StatusSource,
  type TodayItem,
  type TodayLabel,
  type TodayResponse,
} from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function isDone(status: EpisodeStatus): boolean {
  return DONE_STATUSES.includes(status);
}

/** Parses Spotify release dates ("2024", "2024-03", "2024-03-05") to epoch ms. */
export function releaseTime(releaseDate: string): number {
  if (!releaseDate) return 0;
  const parts = releaseDate.split('-');
  const y = Number(parts[0]);
  const m = parts[1] ? Number(parts[1]) - 1 : 0;
  const d = parts[2] ? Number(parts[2]) : 1;
  return Date.UTC(y, m, d);
}

/** Chronological order (oldest first); same-day episodes are ordered by id to stay stable. */
export function compareEpisodesAsc(a: Episode, b: Episode): number {
  const diff = releaseTime(a.releaseDate) - releaseTime(b.releaseDate);
  if (diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Effective status of an episode:
 *  1. an explicit personal status always wins,
 *  2. Spotify's "fully played" counts as completed only if the user opted in,
 *  3. a Spotify resume position means "in progress" (purely informative),
 *  4. otherwise unseen.
 */
export function effectiveStatus(
  episode: Episode,
  progress: EpisodeProgress | undefined,
  settings: Pick<Settings, 'useSpotifyPlayedState'>,
): { status: EpisodeStatus; source: StatusSource } {
  if (progress) return { status: progress.status, source: 'local' };
  const rp = episode.resumePoint;
  if (rp?.fullyPlayed && settings.useSpotifyPlayedState) return { status: 'COMPLETED', source: 'spotify' };
  if (rp && !rp.fullyPlayed && rp.resumePositionMs > 0) return { status: 'IN_PROGRESS', source: 'spotify' };
  return { status: 'UNSEEN', source: 'default' };
}

export function buildEpisodeViews(
  episodes: Episode[],
  progress: Map<string, EpisodeProgress> | Record<string, EpisodeProgress>,
  settings: Pick<Settings, 'useSpotifyPlayedState' | 'newWindowDays'>,
  now: Date = new Date(),
): EpisodeView[] {
  const get = (id: string) => (progress instanceof Map ? progress.get(id) : progress[id]);
  const newSince = now.getTime() - settings.newWindowDays * DAY_MS;
  const sorted = [...episodes].sort(compareEpisodesAsc);
  return sorted.map((ep, i) => {
    const p = get(ep.id);
    const { status, source } = effectiveStatus(ep, p, settings);
    const resumeMs = ep.resumePoint && !ep.resumePoint.fullyPlayed ? ep.resumePoint.resumePositionMs : 0;
    return {
      ...ep,
      status,
      statusSource: source,
      listenedAt: p?.listenedAt,
      skippedAt: p?.skippedAt,
      isNew: status === 'UNSEEN' && releaseTime(ep.releaseDate) >= newSince - DAY_MS,
      remainingMs: Math.max(0, ep.durationMs - resumeMs),
      index: i + 1,
    };
  });
}

/**
 * Picks the episode that should be played next for a show.
 * `episodes` must be sorted oldest first (as returned by buildEpisodeViews).
 */
export function selectNextEpisode(
  show: Pick<Show, 'mode' | 'pinnedEpisodeId' | 'reofferSkipped'>,
  episodes: EpisodeView[],
): EpisodeView | null {
  if (show.pinnedEpisodeId) {
    const pinned = episodes.find((e) => e.id === show.pinnedEpisodeId);
    if (pinned && !isDone(pinned.status)) return pinned;
  }

  switch (show.mode) {
    case 'LATEST': {
      // The newest episode that is newer than anything already finished.
      // Once today's episode is done, yesterday's is not suggested anymore.
      for (let i = episodes.length - 1; i >= 0; i--) {
        const ep = episodes[i];
        if (isDone(ep.status)) return null;
        if (ep.isPlayable !== false) return ep;
      }
      return null;
    }
    case 'SEQUENTIAL': {
      // 1. something already started wins (the most advanced one),
      // 2. otherwise continue after the last finished episode – unmarked
      //    episodes before it count as "left behind", not as next,
      // 3. otherwise fill gaps from the beginning.
      const started = episodes.filter((e) => e.status === 'IN_PROGRESS');
      if (started.length) return started[started.length - 1];
      const open = (e: EpisodeView) => e.status === 'UNSEEN' && e.isPlayable !== false;
      let anchor = -1;
      episodes.forEach((e, i) => {
        if (isDone(e.status)) anchor = i;
      });
      const next = episodes.slice(anchor + 1).find(open) ?? episodes.find(open);
      if (next) return next;
      if (show.reofferSkipped) return episodes.find((e) => e.status === 'SKIPPED') ?? null;
      return null;
    }
    case 'MANUAL':
    default:
      return null;
  }
}

export function summarizeShow(
  show: Pick<Show, 'mode' | 'pinnedEpisodeId' | 'reofferSkipped'>,
  episodes: EpisodeView[],
  now: Date = new Date(),
): ShowSummary {
  let completed = 0;
  let skipped = 0;
  let inProgress = 0;
  let unseen = 0;
  let newCount = 0;
  let lastCompleted: ShowSummary['lastCompleted'];
  for (const ep of episodes) {
    if (ep.status === 'COMPLETED') {
      completed++;
      const at = ep.listenedAt ?? '';
      if (!lastCompleted || at > lastCompleted.at || (at === lastCompleted.at && ep.index > lastCompleted.index)) {
        lastCompleted = { episodeId: ep.id, name: ep.name, at, index: ep.index };
      }
    } else if (ep.status === 'SKIPPED') skipped++;
    else if (ep.status === 'IN_PROGRESS') inProgress++;
    else unseen++;
    if (ep.isNew) newCount++;
  }
  const nextEpisode = selectNextEpisode(show, episodes);
  // For news-like shows only the newest episode matters, not the backlog.
  if (show.mode === 'LATEST') newCount = nextEpisode?.isNew ? 1 : 0;
  return {
    total: episodes.length,
    completed,
    skipped,
    inProgress,
    unseen,
    newCount,
    nextEpisode: nextEpisode ? { ...nextEpisode, description: truncate(nextEpisode.description, 300) } : null,
    latestReleaseDate: episodes.length ? episodes[episodes.length - 1].releaseDate : undefined,
    lastCompleted,
    computedAt: now.toISOString(),
  };
}

export function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text ?? '';
  return text.slice(0, max - 1).trimEnd() + '…';
}

export function toShowLite(show: Show): ShowLite {
  return {
    id: show.id,
    name: show.name,
    imageUrl: show.imageUrl,
    mode: show.mode,
    categories: show.categories,
    total: show.summary?.total ?? 0,
  };
}

function labelFor(show: Show, ep: EpisodeView): TodayLabel {
  if (ep.status === 'IN_PROGRESS') return 'WEITER';
  if (show.pinnedEpisodeId === ep.id) return 'GEWAEHLT';
  if (ep.isNew && show.mode === 'LATEST') return 'NEU';
  return 'NAECHSTE';
}

/**
 * Remaining listening time of the open planned items. An episode planned in
 * several slots is listened to once, so it counts once.
 */
export function plannedOpenMs(items: PlannedItem[]): number {
  const open = new Map<string, number>();
  for (const { episode, state } of items) {
    if (episode && (state === 'next' || state === 'upcoming')) open.set(episode.id, episode.remainingMs);
  }
  return [...open.values()].reduce((sum, ms) => sum + ms, 0);
}

/**
 * Builds the "Heute" view from the shows' denormalised summaries.
 *
 * Budget logic is intentionally simple: walk the candidates in the user's
 * priority order and greedily take every episode that still fits into the
 * remaining budget (plus tolerance). Remaining time accounts for episodes
 * already started in Spotify.
 */
export function buildToday(
  shows: Show[],
  settings: Settings,
  recent: HistoryItem[] = [],
  plan: PlannedItem[] = [],
): TodayResponse {
  // Shows planned for today are listed in the plan, not again below.
  const planned = new Set(plan.map((p) => p.show.id));
  const eligible = shows
    .filter((s) => s.followed && !s.paused && !s.hiddenFromToday && !planned.has(s.id))
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

  const candidates: TodayItem[] = [];
  const noNewEpisode: ShowLite[] = [];
  for (const show of eligible) {
    const ep = show.summary?.nextEpisode;
    if (ep) candidates.push({ show: toShowLite(show), episode: ep, label: labelFor(show, ep) });
    else if (show.mode === 'LATEST') noNewEpisode.push(toShowLite(show));
  }

  const ordered = candidates;

  const budgetMs = settings.audioBudgetMinutes * 60_000;
  const limitMs = budgetMs * (1 + settings.budgetTolerancePercent / 100);
  const recommended: TodayItem[] = [];
  const more: TodayItem[] = [];
  // Planned episodes use up the budget first.
  let usedMs = plannedOpenMs(plan);

  if (budgetMs <= 0) {
    recommended.push(...ordered);
    usedMs += ordered.reduce((sum, c) => sum + c.episode.remainingMs, 0);
  } else {
    for (const c of ordered) {
      if (usedMs + c.episode.remainingMs <= limitMs) {
        recommended.push(c);
        usedMs += c.episode.remainingMs;
      } else {
        more.push(c);
      }
    }
  }

  let budgetFit: TodayResponse['budgetFit'] = 'none';
  if (budgetMs > 0 && usedMs > 0) {
    const ratio = usedMs / budgetMs;
    budgetFit = ratio > 1 ? 'over' : ratio >= 0.85 ? 'perfect' : 'under';
  }

  return {
    plan,
    budgetMinutes: settings.audioBudgetMinutes,
    recommendedMinutes: Math.round(usedMs / 60_000),
    budgetFit,
    recommended,
    more,
    noNewEpisode,
    recent,
    needsReviewCount: shows.filter((s) => s.needsReview).length,
    newCount: shows.filter((s) => !s.paused).reduce((n, s) => n + (s.summary?.newCount ?? 0), 0),
  };
}
