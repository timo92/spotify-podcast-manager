import {
  buildEpisodeViews,
  summarizeShow,
  truncate,
  type EpisodeProgress,
  type EpisodeStatus,
  type EpisodeView,
  type Settings,
  type Show,
  type ShowSettingsPatch,
} from '@podcast/shared';
import { badRequest, notFound } from '../errors.js';
import type { Store } from '../store/types.js';

/**
 * Personal state: show settings and episode progress. Every change ends with
 * `recompute`, which refreshes the denormalised summary on the show item so
 * "Heute" and the overview only need to read the show list.
 */
export class LibraryService {
  constructor(private readonly store: Store) {}

  async loadViews(show: Show, settings?: Settings, now = new Date()): Promise<EpisodeView[]> {
    const [episodes, progress, s] = await Promise.all([
      this.store.listEpisodes(show.id),
      this.store.listProgress(show.id),
      settings ?? this.store.getSettings(),
    ]);
    return buildEpisodeViews(episodes, progress, s, now);
  }

  async recompute(showId: string, settings?: Settings): Promise<Show> {
    const show = await this.requireShow(showId);
    const views = await this.loadViews(show, settings);
    const summary = summarizeShow(show, views);
    await this.store.updateShow(show.id, { summary });
    return { ...show, summary };
  }

  async recomputeAll(): Promise<void> {
    const [shows, settings] = await Promise.all([this.store.listShows(), this.store.getSettings()]);
    await mapLimit(shows, 4, (s) => this.recompute(s.id, settings));
  }

  async requireShow(showId: string): Promise<Show> {
    const show = await this.store.getShow(showId);
    if (!show) throw notFound('show_not_found', 'Podcast nicht gefunden');
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
    if (!view) throw notFound('episode_not_found', 'Folge nicht gefunden');
    return view;
  }

  async updateSettings(showId: string, patch: ShowSettingsPatch): Promise<Show> {
    await this.requireShow(showId);
    const clean: ShowSettingsPatch = {};
    if (patch.mode !== undefined) {
      if (!['LATEST', 'SEQUENTIAL', 'MANUAL'].includes(patch.mode)) throw badRequest('invalid_mode', 'Ungültiger Modus');
      clean.mode = patch.mode;
    }
    if (patch.categories !== undefined) {
      if (!Array.isArray(patch.categories)) throw badRequest('invalid_categories', 'categories muss eine Liste sein');
      clean.categories = [...new Set(patch.categories.map((c) => String(c).trim()).filter(Boolean))].slice(0, 10);
    }
    for (const key of ['paused', 'hiddenFromToday', 'reofferSkipped', 'needsReview'] as const) {
      if (patch[key] !== undefined) clean[key] = Boolean(patch[key]);
    }
    if (patch.priority !== undefined) clean.priority = Number(patch.priority) || 0;
    if (patch.pinnedEpisodeId !== undefined) clean.pinnedEpisodeId = patch.pinnedEpisodeId || null;
    await this.store.updateShow(showId, { ...clean, updatedAt: new Date().toISOString() });
    return this.recompute(showId);
  }

  async reorder(ids: string[]): Promise<void> {
    if (!Array.isArray(ids)) throw badRequest('invalid_order', 'ids muss eine Liste sein');
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
    if (status !== null && !['UNSEEN', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'].includes(status)) {
      throw badRequest('invalid_status', 'Ungültiger Status');
    }
    const show = await this.requireShow(showId);
    const episodes = new Map((await this.store.listEpisodes(showId)).map((e) => [e.id, e]));
    const unknown = episodeIds.filter((id) => !episodes.has(id));
    if (unknown.length) throw notFound('episode_not_found', 'Folge nicht gefunden');

    if (status === null) {
      for (const id of episodeIds) await this.store.deleteProgress(showId, id);
    } else {
      const now = new Date().toISOString();
      const existing = await this.store.listProgress(showId);
      await this.store.putProgress(
        episodeIds.map((id): EpisodeProgress => {
          const ep = episodes.get(id)!;
          const prev = existing.get(id);
          return {
            showId,
            episodeId: id,
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
    if (show.pinnedEpisodeId && episodeIds.includes(show.pinnedEpisodeId) && (status === 'COMPLETED' || status === 'SKIPPED')) {
      await this.store.updateShow(showId, { pinnedEpisodeId: null });
    }
    return this.recompute(showId);
  }

  /** Marks every unfinished episode released before the given one as completed. */
  async completeBefore(showId: string, episodeId: string): Promise<Show> {
    const show = await this.requireShow(showId);
    const views = await this.loadViews(show);
    const target = views.find((v) => v.id === episodeId);
    if (!target) throw notFound('episode_not_found', 'Folge nicht gefunden');
    const ids = views
      .filter((v) => v.index < target.index && v.status !== 'COMPLETED' && v.status !== 'SKIPPED')
      .map((v) => v.id);
    if (!ids.length) return show;
    return this.setStatus(showId, ids, 'COMPLETED');
  }
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

