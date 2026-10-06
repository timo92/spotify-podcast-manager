import { StatusCodes } from 'http-status-codes';
import { ApiError } from '../errors.js';
import type { Store } from '../store/types.js';
import { acquireSyncLease } from './sync.js';

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
      shows: shows.map(({ summary: _summary, summaryRevision: _revision, ...s }) => s),
      progress: progress.flat(),
      schedule,
      notes,
    };
  }

  /**
   * Deletes everything. A running sync would write shows, episodes and tokens
   * back, so this takes the sync lease first: it is refused while a sync runs,
   * and no sync can start during the deletion (one starting afterwards finds no
   * connection to sync).
   */
  async deleteAll(): Promise<void> {
    if (!(await acquireSyncLease(this.store, { message: 'Daten werden gelöscht…' }))) {
      throw new ApiError(StatusCodes.CONFLICT, 'sync_running', 'Gerade läuft ein Sync; bitte danach erneut versuchen.');
    }
    await this.store.deleteAll();
  }
}
