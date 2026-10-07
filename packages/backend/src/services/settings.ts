import { DEFAULT_SETTINGS, type Settings } from '@podcast/shared';
import type { Store } from '../store/types.js';
import type { LibraryService } from './library.js';

/** A whole number in [min, max]; `fallback` when `value` is no number at all. */
function clampedInt(value: unknown, min: number, max: number, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

function categories(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const list = [...new Set(value.map((cat) => String(cat).trim()).filter(Boolean))].slice(0, 50);
  return list.length ? list : DEFAULT_SETTINGS.categories;
}

export class SettingsService {
  constructor(
    private readonly store: Store,
    private readonly library: LibraryService,
  ) {}

  /**
   * Saves the fields of `input` that are valid and keeps the current value of
   * every other one; numbers are clamped to their range. Recomputes all shows
   * when a setting that feeds their summaries changed.
   */
  async save(input: Partial<Record<keyof Settings, unknown>>): Promise<Settings> {
    const current = await this.store.getSettings();
    const next: Settings = {
      audioBudgetMinutes: clampedInt(input.audioBudgetMinutes, 0, 600, current.audioBudgetMinutes),
      budgetTolerancePercent: clampedInt(input.budgetTolerancePercent, 0, 100, current.budgetTolerancePercent),
      newWindowDays: clampedInt(input.newWindowDays, 1, 90, current.newWindowDays),
      useSpotifyPlayedState: flag(input.useSpotifyPlayedState, current.useSpotifyPlayedState),
      autoCompleteInPlayer: flag(input.autoCompleteInPlayer, current.autoCompleteInPlayer),
      playThroughPlaylist: flag(input.playThroughPlaylist, current.playThroughPlaylist),
      categories: categories(input.categories, current.categories),
    };
    await this.store.putSettings(next);
    if (next.newWindowDays !== current.newWindowDays || next.useSpotifyPlayedState !== current.useSpotifyPlayedState) {
      await this.library.recomputeAll();
    }
    return next;
  }
}
