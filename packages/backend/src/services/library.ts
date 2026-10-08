import {
  buildEpisodeViews,
  CONSUMPTION_MODES,
  EPISODE_STATUSES,
  isDone,
  summarizeShow,
  truncate,
  type EpisodeProgress,
  type EpisodeStatus,
  type EpisodeView,
  type Settings,
  type Show,
  type ShowSettingsPatch,
} from '@podcast/shared';

/** Rounds a recompute may lose to concurrent ones before it keeps the stored summary. */
const RECOMPUTE_ATTEMPTS = 3;

/** A show settings change as the API receives it; the mode is checked against the known modes here. */
export type ShowSettingsInput = Omit<ShowSettingsPatch, 'mode'> & { mode?: string };

/** The episode status a client names; `invalid_status` for an unknown one. */
export function episodeStatus(value: string): EpisodeStatus {
  const status = EPISODE_STATUSES.find((s) => s === value);
  if (!status) throw badRequest('invalid_status', 'Ungültiger Status');
  return status;
}
import { badRequest, notFound } from '../errors.js';
import { MAX_SYNC_WINDOW_DAYS } from './settings.js';
import type { Store } from '../store/types.js';

/**
 * Personal state: show settings and episode progress. Every change ends with
 * `recompute`, which refreshes the denormalised summary on the show item so
 * "Heute" and the overview only need to read the show list.
 */
export class LibraryService {
  constructor(private readonly store: Store) {}

  async loadViews(show: Show, settings?: Settings): Promise<EpisodeView[]> {
    const [episodes, progress, s] = await Promise.all([
      this.store.listEpisodes(show.id),
      this.store.listProgress(show.id),
      settings ?? this.store.getSettings(),
    ]);
    return buildEpisodeViews(episodes, progress, s);
  }

  /**
   * Refreshes the show's summary from its episodes and progress. The sync and a
   * user change can recompute at the same time; a summary is only stored on top
   * of the one this computation started from, otherwise it is computed again
   * from the newer data.
   */
  async recompute(showId: string, settings?: Settings): Promise<Show> {
    for (let attempt = 1; ; attempt++) {
      const show = await this.requireShow(showId);
      const summary = summarizeShow(show, await this.loadViews(show, settings));
      if (await this.store.putSummary(showId, summary, show.summaryRevision)) {
        return { ...show, summary, summaryRevision: (show.summaryRevision ?? 0) + 1 };
      }
      // Still losing after a few rounds: the stored summary is at least as new as ours.
      if (attempt >= RECOMPUTE_ATTEMPTS) return this.requireShow(showId);
    }
  }

  async recomputeAll(): Promise<void> {
    const [shows, settings] = await Promise.all([this.store.listShows(), this.store.getSettings()]);
    await mapLimit(shows, 4, (s) => this.recompute(s.id, settings));
  }

  async requireShow(showId: string): Promise<Show> {
    const show = await this.store.getShow(showId);
    if (!show) throw notFound('show_not_found');
    return show;
  }

  async detail(showId: string) {
    const show = await this.requireShow(showId);
    const [views, notes] = await Promise.all([this.loadViews(show), this.store.listShowNotes(showId)]);
    const withNotes = new Set(notes.map((n) => n.episodeId));
    return {
      show,
      episodes: views.map((v) => ({ ...v, description: truncate(v.description, 400), hasNote: withNotes.has(v.id) })),
    };
  }

  async episode(showId: string, episodeId: string): Promise<EpisodeView> {
    const show = await this.requireShow(showId);
    const view = (await this.loadViews(show)).find((v) => v.id === episodeId);
    if (!view) throw notFound('episode_not_found');
    return view;
  }

  async updateSettings(showId: string, patch: ShowSettingsInput): Promise<Show> {
    await this.requireShow(showId);
    // Only fields that are set change; an undefined one would remove the stored value.
    const clean: ShowSettingsPatch = {};
    if (patch.mode !== undefined) {
      clean.mode = CONSUMPTION_MODES.find((m) => m === patch.mode);
      if (!clean.mode) throw badRequest('invalid_mode', 'Ungültiger Modus');
    }
    if (patch.categories !== undefined) {
      clean.categories = [...new Set(patch.categories.map((c) => c.trim()).filter(Boolean))].slice(0, 10);
    }
    for (const key of ['paused', 'hiddenFromToday', 'reofferSkipped', 'needsReview'] as const) {
      const value = patch[key];
      if (value !== undefined) clean[key] = value;
    }
    if (patch.priority !== undefined) clean.priority = patch.priority;
    if (patch.syncWindowDays !== undefined) {
      const days = patch.syncWindowDays === null ? 0 : Math.round(patch.syncWindowDays);
      // 0 or less means "all episodes"; stored as null, as an undefined field would not be written.
      clean.syncWindowDays = days > 0 ? Math.min(days, MAX_SYNC_WINDOW_DAYS) : null;
    }
    if (patch.pinnedEpisodeId !== undefined) clean.pinnedEpisodeId = patch.pinnedEpisodeId || null;
    await this.store.updateShow(showId, { ...clean, updatedAt: new Date().toISOString() });
    return this.recompute(showId);
  }

  async reorder(ids: string[]): Promise<void> {
    const existing = new Set((await this.store.listShows()).map((s) => s.id));
    await mapLimit(
      ids.filter((id) => existing.has(id)),
      5,
      (id, i) => this.store.updateShow(id, { priority: i + 1 }),
    );
  }

  /**
   * Sets the personal status of episodes. `null` removes the personal status so
   * the episode falls back to Spotify's state.
   */
  async setStatus(showId: string, episodeIds: string[], status: EpisodeStatus | null): Promise<Show> {
    const show = await this.requireShow(showId);
    const episodes = new Map((await this.store.listEpisodes(showId)).map((e) => [e.id, e]));
    const selected = episodeIds.flatMap((id) => episodes.get(id) ?? []);
    if (selected.length !== episodeIds.length) throw notFound('episode_not_found');

    if (status === null) {
      for (const id of episodeIds) await this.store.deleteProgress(showId, id);
    } else {
      const now = new Date().toISOString();
      const existing = await this.store.listProgress(showId);
      await this.store.putProgress(
        selected.map((ep): EpisodeProgress => {
          const prev = existing.get(ep.id);
          return {
            showId,
            episodeId: ep.id,
            status,
            listenedAt: status === 'COMPLETED' ? (prev?.status === 'COMPLETED' ? prev.listenedAt : now) : undefined,
            skippedAt: status === 'SKIPPED' ? now : undefined,
            updatedAt: now,
            episodeName: ep.name,
            showName: show.name,
            durationMs: ep.durationMs,
          };
        }),
      );
    }
    // A finished pinned episode no longer needs the pin.
    if (show.pinnedEpisodeId && episodeIds.includes(show.pinnedEpisodeId) && status !== null && isDone(status)) {
      await this.store.updateShow(showId, { pinnedEpisodeId: null });
    }
    return this.recompute(showId);
  }

  /** Marks every unfinished episode released before the given one as completed. */
  async completeBefore(showId: string, episodeId: string): Promise<Show> {
    const show = await this.requireShow(showId);
    const views = await this.loadViews(show);
    const target = views.find((v) => v.id === episodeId);
    if (!target) throw notFound('episode_not_found');
    const ids = views.filter((v) => v.index < target.index && !isDone(v.status)).map((v) => v.id);
    if (!ids.length) return show;
    return this.setStatus(showId, ids, 'COMPLETED');
  }
}

/**
 * Runs `fn` over `items`, at most `limit` at a time. After the first failure
 * no further item is started; the promise rejects with that failure once the
 * running calls have settled, so nothing keeps writing after it returned.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  // One iterator shared by all workers: each takes the next item when it is free.
  const queue = items.entries();
  let failed = false;
  async function worker() {
    for (const [i, item] of queue) {
      if (failed) return;
      try {
        results[i] = await fn(item, i);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  }
  const outcomes = await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, worker));
  const failure = outcomes.find((o) => o.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}
