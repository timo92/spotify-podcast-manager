import { DEFAULT_SETTINGS, type EpisodeView, type PlannedItem, type Show, type ShowLite } from '@podcast/shared';

export const settings = DEFAULT_SETTINGS;

export function show(overrides: Partial<Show> = {}): Show {
  return {
    id: 'wissen',
    source: 'spotify',
    name: 'Wissensreise',
    description: '',
    spotifyUrl: 'https://open.spotify.com/show/wissen',
    mode: 'SEQUENTIAL',
    categories: [],
    paused: false,
    hiddenFromToday: false,
    priority: 1,
    pinnedEpisodeId: null,
    reofferSkipped: false,
    needsReview: false,
    followed: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function showLite(s: Show = show()): ShowLite {
  return { id: s.id, name: s.name, imageUrl: s.imageUrl, mode: s.mode, categories: s.categories, total: 3 };
}

export function episode(index: number, overrides: Partial<EpisodeView> = {}): EpisodeView {
  return {
    id: `ep-${index}`,
    showId: 'wissen',
    name: `Reise: Teil ${index}`,
    description: '',
    releaseDate: `2026-09-0${index}`,
    durationMs: 20 * 60_000,
    spotifyUrl: `https://open.spotify.com/episode/ep-${index}`,
    firstSeenAt: '',
    lastSyncedAt: '',
    status: 'UNSEEN',
    statusSource: 'default',
    isRecent: false,
    isNew: false,
    remainingMs: 20 * 60_000,
    index,
    ...overrides,
  };
}

export function plannedItem(overrides: Partial<PlannedItem> = {}): PlannedItem {
  return { ruleId: 'r1', part: 'EVENING', show: showLite(), episode: episode(1), state: 'next', ...overrides };
}
