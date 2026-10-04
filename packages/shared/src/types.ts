/**
 * Domain types shared between backend and frontend.
 *
 * Spotify is the source of truth for show/episode metadata. Everything the
 * user decides (mode, categories, progress, …) lives in our own store and is
 * never overwritten by a sync.
 */

export type ConsumptionMode = 'LATEST' | 'SEQUENTIAL' | 'MANUAL';

export const CONSUMPTION_MODES: ConsumptionMode[] = ['LATEST', 'SEQUENTIAL', 'MANUAL'];

export type EpisodeStatus = 'UNSEEN' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';

/** Statuses that mean "done with this one, don't suggest it again". */
export const DONE_STATUSES: EpisodeStatus[] = ['COMPLETED', 'SKIPPED'];

export interface ResumePoint {
  fullyPlayed: boolean;
  resumePositionMs: number;
}

/** Episode metadata as cached from Spotify. */
export interface Episode {
  id: string;
  showId: string;
  name: string;
  /** Plain-text description, truncated. */
  description: string;
  /** ISO date (YYYY-MM-DD) or partial date depending on precision. */
  releaseDate: string;
  durationMs: number;
  imageUrl?: string;
  spotifyUrl: string;
  explicit?: boolean;
  isPlayable?: boolean;
  /** Spotify's own resume point (needs scope user-read-playback-position). */
  resumePoint?: ResumePoint;
  firstSeenAt: string;
  lastSyncedAt: string;
}

/** Personal progress for one episode. Never written by a sync. */
export interface EpisodeProgress {
  showId: string;
  episodeId: string;
  status: EpisodeStatus;
  listenedAt?: string;
  skippedAt?: string;
  updatedAt: string;
  /** Snapshot for the history list so we don't need a join. */
  episodeName?: string;
  showName?: string;
  durationMs?: number;
}

/** Where the effective status of an episode comes from. */
export type StatusSource = 'local' | 'spotify' | 'default';

/** Episode merged with personal progress – what the UI renders. */
export interface EpisodeView extends Episode {
  status: EpisodeStatus;
  statusSource: StatusSource;
  listenedAt?: string;
  skippedAt?: string;
  isNew: boolean;
  /** Remaining listening time, taking Spotify's resume point into account. */
  remainingMs: number;
  /** 1-based position in chronological (oldest first) order. */
  index: number;
  /** A personal note exists for this episode. */
  hasNote?: boolean;
}

export interface ShowSummary {
  total: number;
  completed: number;
  skipped: number;
  inProgress: number;
  unseen: number;
  newCount: number;
  nextEpisode: EpisodeView | null;
  latestReleaseDate?: string;
  /** Most recent episode the user completed, for "where am I". */
  lastCompleted?: { episodeId: string; name: string; at: string; index: number };
  computedAt: string;
}

export interface Show {
  /** Spotify show id. */
  id: string;
  source: 'spotify';
  name: string;
  publisher?: string;
  description: string;
  imageUrl?: string;
  spotifyUrl: string;
  totalEpisodes?: number;
  mediaType?: string;

  // ---- personal settings ----
  mode: ConsumptionMode;
  categories: string[];
  /** Temporarily paused: not suggested on "Heute". */
  paused: boolean;
  /** Permanently removed from "Heute" (still tracked in the overview). */
  hiddenFromToday: boolean;
  /** Lower number = higher priority. */
  priority: number;
  /** Manually chosen next episode (overrides the automatic choice). */
  pinnedEpisodeId?: string | null;
  /** SEQUENTIAL: offer skipped episodes again once everything else is done. */
  reofferSkipped: boolean;
  /** Imported automatically and not yet reviewed by the user. */
  needsReview: boolean;
  /** Still saved in the Spotify library. */
  followed: boolean;

  // ---- bookkeeping ----
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
  /** Set once all episodes have been imported at least once. */
  fullSyncAt?: string;
  lastSyncError?: string;

  /** Denormalised summary, recomputed after every change. */
  summary?: ShowSummary;
}

/** Fields of a show the user may change. */
export type ShowSettingsPatch = Partial<
  Pick<
    Show,
    'mode' | 'categories' | 'paused' | 'hiddenFromToday' | 'priority' | 'pinnedEpisodeId' | 'reofferSkipped' | 'needsReview'
  >
>;

export interface Settings {
  /** Daily audio budget in minutes. 0 disables the budget. */
  audioBudgetMinutes: number;
  /** How much a selection may exceed the budget (percent). */
  budgetTolerancePercent: number;
  /** Episodes released within this many days count as "NEU". */
  newWindowDays: number;
  /** Treat episodes Spotify reports as fully played as completed. */
  useSpotifyPlayedState: boolean;
  /** Mark an episode as completed when the in-app player reaches the end. */
  autoCompleteInPlayer: boolean;
  categories: string[];
}

export const DEFAULT_CATEGORIES = [
  'Nachrichten',
  'Politik',
  'Wirtschaft',
  'Geschichte',
  'Geographie',
  'Philosophie',
  'Wissenschaft',
  'Gesellschaft',
  'Sonstiges',
];

export const DEFAULT_SETTINGS: Settings = {
  audioBudgetMinutes: 30,
  budgetTolerancePercent: 10,
  newWindowDays: 7,
  useSpotifyPlayedState: true,
  autoCompleteInPlayer: true,
  categories: DEFAULT_CATEGORIES,
};

export type TodayLabel = 'NEU' | 'WEITER' | 'NAECHSTE' | 'GEWAEHLT';

export interface ShowLite {
  id: string;
  name: string;
  imageUrl?: string;
  mode: ConsumptionMode;
  categories: string[];
  total: number;
}

export interface TodayItem {
  show: ShowLite;
  episode: EpisodeView;
  label: TodayLabel;
}

export interface HistoryItem {
  showId: string;
  episodeId: string;
  showName?: string;
  episodeName?: string;
  status: EpisodeStatus;
  at: string;
}

export interface TodayResponse {
  /** Today's slots from the weekly plan (empty if nothing is planned). */
  plan: PlannedItem[];
  budgetMinutes: number;
  /** Sum of remaining minutes of the recommended items. */
  recommendedMinutes: number;
  budgetFit: 'none' | 'perfect' | 'under' | 'over';
  recommended: TodayItem[];
  more: TodayItem[];
  noNewEpisode: ShowLite[];
  recent: HistoryItem[];
  needsReviewCount: number;
  newCount: number;
}

export interface SyncState {
  status: 'idle' | 'running' | 'error';
  startedAt?: string;
  finishedAt?: string;
  lastSuccessAt?: string;
  message?: string;
  error?: string;
  showsSynced?: number;
  newEpisodes?: number;
}

export interface AppStatus {
  configured: boolean;
  authenticated: boolean;
  /** Redirect URI that must be registered in the Spotify developer dashboard. */
  redirectUri: string;
  setupCodeRequired: boolean;
  /** An owner account has logged in at least once (setup is locked). */
  claimed: boolean;
  spotifyConnected?: boolean;
  user?: { id: string; displayName?: string };
  sync?: SyncState;
  /** Scopes granted by the user, used to explain missing permissions. */
  grantedScopes?: string[];
  missingScopes?: string[];
}

export interface ShowDetailResponse {
  show: Show;
  episodes: EpisodeView[];
}

export interface PlayerDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

// ---------------------------------------------------------------- weekly plan

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type DayPart = 'MORNING' | 'MIDDAY' | 'EVENING' | 'ANYTIME';

export const DAY_PARTS: DayPart[] = ['MORNING', 'MIDDAY', 'EVENING', 'ANYTIME'];

/** A recurring slot: "listen to <show> on <weekday> in the <part>". */
export interface ScheduleEntry {
  id: string;
  showId: string;
  weekday: Weekday;
  part: DayPart;
}

export interface Schedule {
  entries: ScheduleEntry[];
  updatedAt?: string;
}

/**
 * done     – an episode of this show was finished on that day (today only)
 * next     – the episode that is actually next right now
 * upcoming – projected later episode of a series (after the ones planned before)
 * latest   – news-like show on a future day: whatever is newest then
 * none     – nothing open (all heard / nothing pinned)
 */
export type PlannedState = 'done' | 'next' | 'upcoming' | 'latest' | 'none';

export interface PlannedItem {
  entryId: string;
  part: DayPart;
  show: ShowLite;
  episode: EpisodeView | null;
  state: PlannedState;
}

export interface PlanDay {
  date: string;
  weekday: Weekday;
  isToday: boolean;
  items: PlannedItem[];
  /** Remaining listening time of the open items. */
  openMs: number;
}

export interface WeekResponse {
  days: PlanDay[];
}

// ---------------------------------------------------------------------- notes

export interface EpisodeNote {
  showId: string;
  episodeId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
  episodeName?: string;
  showName?: string;
}
