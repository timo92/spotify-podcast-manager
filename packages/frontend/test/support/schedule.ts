import type { Schedule, ScheduleRule } from '@podcast/shared';
import { vi } from 'vitest';
import { api, ApiError } from '../../src/lib/api';

export const CONFLICT_MESSAGE = 'Der Wochenplan wurde inzwischen an anderer Stelle geändert.';

/**
 * Mocks the plan endpoints like the server: a stored plan that each save
 * replaces with a new version, and a `schedule_conflict` for a save based on
 * an older version. `changeElsewhere` replaces the plan as another tab would.
 */
export function mockSchedule(rules: ScheduleRule[]) {
  let stored: Schedule = { rules };
  let version = 0;
  const replace = (next: ScheduleRule[]) => {
    version += 1;
    stored = { rules: next, updatedAt: `v${version}` };
    return stored;
  };
  vi.spyOn(api, 'schedule').mockImplementation(async () => stored);
  const saveSchedule = vi.spyOn(api, 'saveSchedule').mockImplementation(async (save) => {
    if (save.expectedUpdatedAt !== undefined && save.expectedUpdatedAt !== (stored.updatedAt ?? null)) {
      throw new ApiError(409, 'schedule_conflict', CONFLICT_MESSAGE);
    }
    return replace(save.rules);
  });
  return { saveSchedule, changeElsewhere: replace };
}
