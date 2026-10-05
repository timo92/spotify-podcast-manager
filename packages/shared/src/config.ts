/**
 * Value the stack puts into the Spotify client-secret parameter when it
 * creates it. The real secret is set after deploying (`pnpm run secret:put`);
 * until then the API reports the app as not configured.
 */
export const SPOTIFY_CLIENT_SECRET_PLACEHOLDER = 'REPLACE_WITH_SPOTIFY_CLIENT_SECRET';
