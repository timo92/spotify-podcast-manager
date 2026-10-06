import { randomBytes } from 'node:crypto';
import type { AppStatus } from '@podcast/shared';
import { SCOPES } from '../spotify/client.js';
import type { SpotifyCredentialsProvider } from '../spotify/credentials.js';
import type { SpotifyAuth } from '../spotify/auth.js';
import type { Store } from '../store/types.js';
import { visibleSyncState } from './sync.js';

export type SpotifyLogin = Awaited<ReturnType<SpotifyAuth['login']>>;

const SESSION_DAYS = 90;
/** How long a session (and its cookie) stays valid. */
export const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;

/** Who may use the app (the owner), their Spotify connection and their sessions. */
export class AuthService {
  constructor(
    private readonly store: Store,
    private readonly credentials: SpotifyCredentialsProvider,
  ) {}

  async isAuthenticated(sessionId: string | undefined): Promise<boolean> {
    return !!sessionId && !!(await this.store.getSession(sessionId));
  }

  /** What the app shows before and after login; details only for a signed-in user. */
  async status(authenticated: boolean, redirectUri: string): Promise<AppStatus> {
    const [config, configured] = await Promise.all([this.store.getConfig(), this.credentials.ready()]);
    const status: AppStatus = { configured, authenticated, redirectUri, claimed: !!config };
    if (!authenticated) return status;
    const [tokens, sync] = await Promise.all([this.store.getTokens(), this.store.getSyncState()]);
    const granted = (tokens?.scope ?? '').split(' ').filter(Boolean);
    return {
      ...status,
      spotifyConnected: !!tokens,
      disconnectedAt: config?.disconnectedAt,
      user: config?.ownerId ? { id: config.ownerId, displayName: config.ownerName } : undefined,
      sync: visibleSyncState(sync),
      grantedScopes: granted,
      missingScopes: tokens ? SCOPES.filter((s) => !granted.includes(s)) : [],
    };
  }

  /**
   * Completes a Spotify login: the first account becomes the owner, a later
   * login must be the owner's. Stores the tokens and opens a session. Returns
   * undefined for another account; `firstRun` when nothing was imported yet.
   */
  async login({ tokens, user }: SpotifyLogin): Promise<{ sessionId: string; firstRun: boolean } | undefined> {
    // Only accounts listed under "User Management" of the Spotify app can log in
    // at all (development mode).
    const config = await this.store.getConfig();
    if (config && config.ownerId !== user.id) return undefined;
    // Writing the config without `disconnectedAt` also ends a revoked state, so
    // the retention rules no longer delete the data. The claim is conditional:
    // another account may have become the owner since the read above.
    if (!config || config.disconnectedAt || config.ownerName !== (user.display_name ?? undefined)) {
      const now = new Date().toISOString();
      const claimed = await this.store.claimConfig({
        ownerId: user.id,
        ownerName: user.display_name ?? undefined,
        createdAt: config?.createdAt ?? now,
        updatedAt: now,
      });
      if (!claimed) return undefined;
    }
    const previous = await this.store.getTokens();
    await this.store.putTokens({ ...tokens, refreshToken: tokens.refreshToken || previous?.refreshToken || '' });

    const sessionId = randomBytes(32).toString('base64url');
    await this.store.putSession({
      id: sessionId,
      createdAt: new Date().toISOString(),
      expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    });
    const firstRun = (await this.store.listShows()).length === 0;
    return { sessionId, firstRun };
  }

  async logout(sessionId: string | undefined): Promise<void> {
    if (sessionId) await this.store.deleteSession(sessionId);
  }
}
