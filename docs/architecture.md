# How it works

![Architecture](architecture.svg)

Why it is built this way: [decisions/](decisions/README.md).

- **Single origin.** CloudFront serves the SPA from S3 and forwards `/api/*` to API Gateway (HTTP API) and a Lambda function running a [Hono](https://hono.dev) app. Because everything is on one origin, there is no CORS.
- **Cookies.** The session cookie is `HttpOnly`, `Secure` and `SameSite=Strict`. The short-lived OAuth state cookie is `SameSite=Lax`, because Spotify's redirect back to the app is a cross-site navigation and browsers drop `Strict` cookies on those. Requests that change data must be sent as JSON, which works as an additional CSRF guard.
- **Tokens stay on the server.** Spotify access and refresh tokens are kept in DynamoDB. The browser only gets a short-lived access token for the Web Playback SDK, which needs one.
- **Sync** runs in a separate Lambda function: asynchronously from the API (because API Gateway times out after 29 s), every 2 hours, and once a day as a full refresh. A lease in DynamoDB (a conditional write on the sync state) ensures that two syncs never run at once.
- **Data model:** one DynamoDB table. Episodes (`EP#<show>`) and progress (`PROG#<show>`) are separate items, so a sync can never overwrite your progress. Each show item carries a summary (next episode, counts) that is recomputed after every change. That way, "Today" and the overview only need to read the list of shows. Details are in [`packages/backend/src/store/dynamo.ts`](../packages/backend/src/store/dynamo.ts).
- **Spotify layer:** [`packages/backend/src/spotify`](../packages/backend/src/spotify). It refreshes tokens (including rotated refresh tokens), retries on 429 using `Retry-After` and on 5xx errors, and turns 401/403 into readable messages. The `SpotifyApi` interface can be replaced, for example by the offline fake or a future YouTube source. See [docs/spotify-api.md](spotify-api.md) for the endpoints used and the 2026 restrictions for apps in development mode.
