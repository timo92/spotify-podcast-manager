import type { Store } from '../store/types.js';

/** All personal data at once: the export and "delete all data". */
export class DataService {
  constructor(private readonly store: Store) {}

  /** Everything the user set or recorded, without what the sync can fetch again. */
  async export() {
    const [shows, settings, schedule, notes] = await Promise.all([
      this.store.listShows(),
      this.store.getSettings(),
      this.store.getSchedule(),
      this.store.listNotes(10_000),
    ]);
    const progress = await Promise.all(shows.map(async (s) => [...(await this.store.listProgress(s.id)).values()]));
    return {
      exportedAt: new Date().toISOString(),
      settings,
      shows: shows.map(({ summary: _summary, ...s }) => s),
      progress: progress.flat(),
      schedule,
      notes,
    };
  }

  deleteAll(): Promise<void> {
    return this.store.deleteAll();
  }
}
