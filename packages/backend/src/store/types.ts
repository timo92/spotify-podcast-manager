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

  getTokens(): Promise<SpotifyTokens | undefined>;
  putTokens(tokens: SpotifyTokens): Promise<void>;

  getSettings(): Promise<Settings>;
  putSettings(settings: Settings): Promise<void>;

  getSyncState(): Promise<SyncState>;
  putSyncState(state: SyncState): Promise<void>;

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

  getSchedule(): Promise<Schedule>;
  putSchedule(schedule: Schedule): Promise<void>;

  getNote(showId: string, episodeId: string): Promise<EpisodeNote | undefined>;
  putNote(note: EpisodeNote): Promise<void>;
  deleteNote(showId: string, episodeId: string): Promise<void>;
  listShowNotes(showId: string): Promise<EpisodeNote[]>;
  /** All notes, most recently edited first. */
  listNotes(limit: number): Promise<EpisodeNote[]>;

  /** Removes every item, including configuration and tokens. */
  deleteAll(): Promise<void>;
}
