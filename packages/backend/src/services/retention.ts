import { RETENTION_DAYS } from '@podcast/shared';
import type { Store } from '../store/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionResult {
  /** Shows removed because they left the Spotify library long ago. */
  deletedShows: string[];
  /** Everything was removed because Spotify access stayed revoked. */
  deletedAll: boolean;
}

/**
 * Spotify's Developer Policy allows keeping Spotify content only as long as
 * the app needs it and requires deleting a user's data once they disconnect.
 * Runs on every sync (and on scheduled runs while disconnected):
 *
 * - access revoked for RETENTION_DAYS without a new login → delete everything,
 * - a show unfollowed for RETENTION_DAYS → delete it with its episodes,
 *   progress, notes and weekly-plan slots.
 *
 * The grace period lets a podcast followed again, or a login after an
 * accidental revocation, pick up where the user left off.
 */
export async function applyRetention(store: Store, now = new Date()): Promise<RetentionResult> {
  const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
  const expired = (iso: string | undefined) => !!iso && Date.parse(iso) < cutoff;

  const config = await store.getConfig();
  if (expired(config?.disconnectedAt)) {
    await store.deleteAll();
    return { deletedShows: [], deletedAll: true };
  }

  const stale = (await store.listShows()).filter((s) => !s.followed && expired(s.unfollowedAt)).map((s) => s.id);
  if (stale.length) {
    for (const id of stale) await store.deleteShow(id);
    const schedule = await store.getSchedule();
    const entries = schedule.entries.filter((e) => !stale.includes(e.showId));
    if (entries.length !== schedule.entries.length) {
      await store.putSchedule({ entries, updatedAt: now.toISOString() });
    }
  }
  return { deletedShows: stale, deletedAll: false };
}
