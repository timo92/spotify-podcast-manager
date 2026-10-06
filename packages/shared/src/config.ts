/**
 * Value the stack puts into the Spotify client-secret parameter when it
 * creates it. The real secret is set after deploying (`pnpm run secret:put`);
 * until then the API reports the app as not configured.
 */
export const SPOTIFY_CLIENT_SECRET_PLACEHOLDER = 'REPLACE_WITH_SPOTIFY_CLIENT_SECRET';

/**
 * Header CloudFront adds to every API request, with a value only the stack
 * knows. The API refuses requests without it, so it can't be called directly
 * at its API Gateway endpoint, bypassing CloudFront.
 */
export const ORIGIN_VERIFY_HEADER = 'x-origin-verify';

/**
 * Spotify content may only be kept as long as the app needs it (Spotify
 * Developer Policy). Podcasts removed from the Spotify library, and all data
 * after Spotify access was revoked, are deleted after this many days unless
 * the user follows the podcast again or reconnects.
 */
export const RETENTION_DAYS = 30;

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When data marked at `since` (unfollowed, disconnected) is deleted. The UI
 * shows this date and the backend enforces it, so both use this one function.
 */
export function retentionExpiry(since: string): Date {
  return new Date(Date.parse(since) + RETENTION_DAYS * DAY_MS);
}

export function isRetentionExpired(since: string | undefined, now: Date = new Date()): boolean {
  return !!since && retentionExpiry(since).getTime() < now.getTime();
}
