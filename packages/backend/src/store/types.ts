import type { Episode, EpisodeNote, EpisodeProgress, Schedule, Settings, Show, SyncState } from '@podcast/shared';

/**
 * The app's owner, bound on the first successful login. The Spotify app
 * credentials are not stored here – they come from the deployment
 * (see spotify/credentials.ts).
 */
export interface AppConfig {
  /** Spotify user id of the owner. */
  ownerId: string;
  ownerName?: string;
  /** Set when Spotify rejected our refresh token (access revoked); cleared on the next login. */
  disconnectedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  scope: string;
}

export interface Session {
  id: string;
  createdAt: string;
  /** Epoch seconds (DynamoDB TTL). */
  expiresAt: number;
}

/**
 * Persistence boundary. Implemented by DynamoStore (AWS) and MemoryStore
 * (local development and tests). Show updates are partial on purpose so a
 * running sync never overwrites settings the user changed meanwhile.
 */
export interface Store {
  getConfig(): Promise<AppConfig | undefined>;
  putConfig(config: AppConfig): Promise<void>;
  /** Sets `disconnectedAt` on an existing config unless it is already set (atomic). */
  markDisconnected(at: string): Promise<void>;
  /**
   * Deletes the config only if its `disconnectedAt` is still `disconnectedAt`, so a
   * login that just cleared it wins. Returns whether it deleted.
   */
  deleteConfigIfDisconnectedAt(disconnectedAt: string): Promise<boolean>;

  getTokens(): Promise<SpotifyTokens | undefined>;
  putTokens(tokens: SpotifyTokens): Promise<void>;
  /**
   * Deletes the tokens only if they still hold `refreshToken` (so tokens a
   * concurrent refresh or login just stored survive). Returns whether it deleted.
   */
  deleteTokens(refreshToken: string): Promise<boolean>;

  getSettings(): Promise<Settings>;
  putSettings(settings: Settings): Promise<void>;

  getSyncState(): Promise<SyncState>;
  putSyncState(state: SyncState): Promise<void>;
  /**
   * Atomically writes `state` (status 'running', with `leaseId`) unless another
   * sync holds a lease that started after `staleBefore`. A lease whose id is
   * `takeOver` counts as free (the API acquires it, the sync Lambda takes it
   * over). Returns whether the lease was acquired.
   */
  acquireSyncLease(state: SyncState & { leaseId: string }, staleBefore: string, takeOver?: string): Promise<boolean>;
  /** Writes the final `state` only if `leaseId` still holds the lease. Returns whether it did. */
  releaseSyncLease(leaseId: string, state: SyncState): Promise<boolean>;

  putSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | undefined>;
  deleteSession(id: string): Promise<void>;

  listShows(): Promise<Show[]>;
  getShow(id: string): Promise<Show | undefined>;
  putShow(show: Show): Promise<void>;
  /** Sets only the given attributes. */
  updateShow(id: string, fields: Partial<Show>): Promise<void>;

  listEpisodes(showId: string): Promise<Episode[]>;
  getEpisode(showId: string, episodeId: string): Promise<Episode | undefined>;
  putEpisodes(episodes: Episode[]): Promise<void>;
  deleteEpisodes(showId: string, episodeIds: string[]): Promise<void>;

  listProgress(showId: string): Promise<Map<string, EpisodeProgress>>;
  putProgress(progress: EpisodeProgress[]): Promise<void>;
  deleteProgress(showId: string, episodeId: string): Promise<void>;
  /** Most recently completed episodes across all shows, newest first. */
  listHistory(limit: number): Promise<EpisodeProgress[]>;

  /** The weekly plan as rules; a schedule stored in the legacy shape is converted (migrateSchedule). */
  getSchedule(): Promise<Schedule>;
  /**
   * With `expectedUpdatedAt`, writes only if the stored schedule still has that
   * `updatedAt` (null: no schedule stored yet). Returns whether it wrote.
   */
  putSchedule(schedule: Schedule, expectedUpdatedAt?: string | null): Promise<boolean>;

  getNote(showId: string, episodeId: string): Promise<EpisodeNote | undefined>;
  putNote(note: EpisodeNote): Promise<void>;
  deleteNote(showId: string, episodeId: string): Promise<void>;
  listShowNotes(showId: string): Promise<EpisodeNote[]>;
  /** All notes, most recently edited first. */
  listNotes(limit: number): Promise<EpisodeNote[]>;

  /** Removes a show with its episodes, progress and notes. */
  deleteShow(showId: string): Promise<void>;

  /** Removes every item, including configuration and tokens. */
  deleteAll(): Promise<void>;
}
