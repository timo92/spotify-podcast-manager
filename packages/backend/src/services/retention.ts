import { isRetentionExpired } from '@podcast/shared';
import type { Store } from '../store/types.js';

export interface RetentionResult {
  /** Shows removed because they left the Spotify library long ago. */
  deletedShows: string[];
  /** Everything was removed because Spotify access stayed revoked. */
  deletedAll: boolean;
}

/**
 * Spotify's Developer Policy allows keeping Spotify content only as long as
 * the app needs it and requires deleting a user's data once they disconnect.
 * Runs after every successful library sync, incremental or full (and on
 * scheduled runs while Spotify is disconnected):
 *
 * - access revoked for RETENTION_DAYS without a new login → delete everything,
 * - a show unfollowed for RETENTION_DAYS → delete it with its episodes,
 *   progress, notes and weekly-plan slots.
 *
 * The grace period lets a podcast followed again, or a login after an
 * accidental revocation, pick up where the user left off.
 */
export async function applyRetention(store: Store, now = new Date()): Promise<RetentionResult> {
  const config = await store.getConfig();
  if (config?.disconnectedAt && isRetentionExpired(config.disconnectedAt, now) && !(await store.getTokens())) {
    // Claim the wipe atomically: a login at this moment clears disconnectedAt,
    // and then the conditional delete fails and nothing is wiped.
    if (await store.deleteConfigIfDisconnectedAt(config.disconnectedAt)) {
      await store.deleteAll();
      return { deletedShows: [], deletedAll: true };
    }
  }

  const stale = (await store.listShows())
    .filter((s) => !s.followed && isRetentionExpired(s.unfollowedAt, now))
    .map((s) => s.id);
  if (stale.length) {
    for (const id of stale) await store.deleteShow(id);
    await removeFromSchedule(store, stale, now);
  }
  return { deletedShows: stale, deletedAll: false };
}

/** Drops the shows' rules; retries if the user saved the plan at the same time. */
async function removeFromSchedule(store: Store, showIds: string[], now: Date) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const schedule = await store.getSchedule();
    const rules = schedule.rules.filter((r) => !showIds.includes(r.showId));
    if (rules.length === schedule.rules.length) return;
    const written = await store.putSchedule({ rules, updatedAt: now.toISOString() }, schedule.updatedAt ?? null);
    if (written) return;
  }
  // A concurrent save keeps winning; saveSchedule drops unknown shows anyway.
  console.warn('Could not remove deleted shows from the weekly plan', showIds);
}
