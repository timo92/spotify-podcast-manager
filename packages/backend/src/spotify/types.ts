/** Subset of the Spotify Web API payloads we rely on. */

export interface SpotifyImage {
  url: string;
  height?: number | null;
  width?: number | null;
}

export interface SpotifyShow {
  id: string;
  name: string;
  description?: string;
  /** Removed for development-mode apps in Feb 2026 – treat as optional. */
  publisher?: string;
  images?: SpotifyImage[];
  external_urls?: { spotify?: string };
  total_episodes?: number;
  media_type?: string;
}

export interface SpotifyEpisode {
  id: string;
  name: string;
  description?: string;
  release_date: string;
  release_date_precision?: 'year' | 'month' | 'day';
  duration_ms: number;
  images?: SpotifyImage[];
  external_urls?: { spotify?: string };
  explicit?: boolean;
  is_playable?: boolean;
  resume_point?: { fully_played: boolean; resume_position_ms: number };
}

export interface SpotifyPage<T> {
  items: (T | null)[];
  next: string | null;
  total: number;
  limit: number;
  offset: number;
}

export interface SpotifyUser {
  id: string;
  display_name?: string | null;
}

export interface SpotifyDevice {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted?: boolean;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}

/**
 * Everything the app needs from Spotify. Implemented by the real HTTP client
 * and by a fake for local development/tests, which keeps the integration
 * swappable (e.g. for a future YouTube source).
 */
export interface SpotifyApi {
  getMe(): Promise<SpotifyUser>;
  getSavedShows(): Promise<SpotifyShow[]>;
  /**
   * Returns episodes newest first. Paging stops early once `stopAfterPage`
   * returns true for a fetched page (used for incremental syncs).
   */
  getShowEpisodes(showId: string, stopAfterPage?: (page: SpotifyEpisode[]) => boolean): Promise<SpotifyEpisode[]>;
  getEpisode(episodeId: string): Promise<SpotifyEpisode | undefined>;
  getDevices(): Promise<SpotifyDevice[]>;
  play(episodeId: string, deviceId: string | undefined, positionMs: number): Promise<void>;
  /** Short-lived access token for the Web Playback SDK in the browser. */
  getAccessToken(): Promise<{ accessToken: string; expiresAt: number }>;
}
