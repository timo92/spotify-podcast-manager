# Spotify Web API usage

All Spotify access goes through `packages/backend/src/spotify/client.ts`
(`HttpSpotifyApi`, implementing the `SpotifyApi` interface). Nothing else talks
to Spotify, apart from the token exchange during login and the Web Playback
SDK in the browser.

## Endpoints

| Purpose | Endpoint | Scope |
| --- | --- | --- |
| Login | `GET accounts.spotify.com/authorize`, `POST /api/token` (authorization code + refresh) | – |
| Owner check | `GET /v1/me` | – |
| Saved shows | `GET /v1/me/shows` (paged, 50) | `user-library-read` |
| Episodes of a show | `GET /v1/shows/{id}/episodes` (paged, 50, newest first) | `user-read-playback-position` for `resume_point` |
| Single episode (resume point before playback, refresh of the "next" episode) | `GET /v1/episodes/{id}` | `user-read-playback-position` |
| Devices | `GET /v1/me/player/devices` | `user-read-playback-state` |
| Start playback | `PUT /v1/me/player/play?device_id=…` with `uris` and `position_ms` | `user-modify-playback-state` |
| In-browser player | Web Playback SDK (`https://sdk.scdn.co/spotify-player.js`) | `streaming`, `user-read-email`, `user-read-private` |


## Restrictions to know about (as of 2026)

- **Development mode** (the default for new apps):
  - The app owner needs an active **Premium** subscription.
  - At most **5 users**, and they must be added under *User Management* in the dashboard. The owner is allowed automatically.
  - Since **February 2026** (existing apps were migrated on 2026-03-09), several endpoints are gone. This app uses none of them:
    - batch lookups such as `GET /shows?ids=` and `GET /episodes?ids=`
    - browse/categories
    - other users' profiles
  - Library writes moved to the generic `PUT/DELETE /me/library`. The app only reads the library, so it is not affected.
  - The show object lost `publisher` and `available_markets`. `publisher` is treated as optional.
- The **Web Playback SDK** needs Premium. It does not work in mobile browsers, so on phones the app opens the Spotify app or plays on a Spotify Connect device instead.
- **Rate limits** are applied per app over a rolling 30-second window. The client:
  - waits for `Retry-After` and retries when it is at most 20 s,
  - gives up with a readable message when it is longer,
  - retries 5xx errors twice.
  - The sync fetches at most 3 shows in parallel. Incremental syncs stop paging as soon as they reach a known episode.
- **Refresh tokens** may be rotated. A new refresh token from the token endpoint replaces the stored one.
- `resume_point` only reflects listening on Spotify. Your own marks in the app always take precedence. You can switch off whether "fully played" counts as heard (Settings → *Spotify-Hörstand übernehmen*).

## Error mapping

| Spotify | App |
| --- | --- |
| 401 | Refresh the token once and retry. If it fails again, the error is `spotify_reauth` and you need to log in again. |
| 403 | `spotify_forbidden`, with a hint: missing scope, user not on the allow-list, or the app owner has no Premium. |
| 404 `NO_ACTIVE_DEVICE` | `no_active_device`, asking you to open Spotify on a device. |
| 429 | Wait and retry, or `spotify_rate_limited`. |

A failing show during a sync is recorded on that show (`lastSyncError`) and
does not abort the whole sync. Auth and rate-limit errors do abort it.
