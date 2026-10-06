# D6 — Login with Spotify only; server-side sessions

**Decision.**
- The first Spotify account that logs in becomes the owner; any other
  account is rejected.
- Sessions are random IDs stored in DynamoDB (TTL 90 days), sent as an
  `HttpOnly`, `Secure`, `SameSite=Strict` cookie.
- The short-lived OAuth `state` cookie is `SameSite=Lax`, because Spotify's
  redirect back to `/api/auth/callback` is a cross-site navigation and browsers
  drop `Strict` cookies on those.
- Requests that change data must be JSON (a CSRF guard on top of `SameSite`).
- The first account that logs in becomes the owner. Nobody else can win that
  race: in Spotify's development mode, only accounts listed under *User
  Management* of the Spotify app can log in at all.
- An earlier version protected a browser setup page with a one-time setup
  code; it became unnecessary once the credentials moved into the deployment
  (D7).

**Why.** The user needs a Spotify login anyway. A second identity system
(Cognito) would mean a second password for a single person. Server-side
sessions can be revoked (logout, "delete all data"), unlike stateless tokens.
