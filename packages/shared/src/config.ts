/**
 * Value the stack puts into the Spotify client-secret parameter when it
 * creates it. The real secret is set after deploying (`pnpm run secret:put`);
 * until then the API reports the app as not configured.
 */
export const SPOTIFY_CLIENT_SECRET_PLACEHOLDER = 'REPLACE_WITH_SPOTIFY_CLIENT_SECRET';

/**
 * Spotify content may only be kept as long as the app needs it (Spotify
 * Developer Policy). Podcasts removed from the Spotify library, and all data
 * after Spotify access was revoked, are deleted after this many days unless
 * the user follows the podcast again or reconnects.
 */
export const RETENTION_DAYS = 30;
