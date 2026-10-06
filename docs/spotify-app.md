# The Spotify app

The app talks to Spotify through **your own Spotify developer app**. That is
nothing more than an entry in Spotify's developer dashboard that gives you a
Client ID and Client Secret. You create it once and use it both locally and on
AWS:

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app (name and description are up to you).
2. Under **APIs used**, select *Web API* and *Web Playback SDK*.
3. Under **Redirect URIs**, add every address the app runs at. One app can have several:
   - `http://127.0.0.1:5173/api/auth/callback` for local development. Spotify only allows plain `http` for loopback IPs, not for `localhost`.
   - `https://<your domain>/api/auth/callback` for AWS (shown as the `SpotifyRedirectUri` output after deploying).
4. Copy the Client ID and Client Secret from the app's settings into your `.env` (see [Configuration](deployment.md#1-configuration) for AWS, [Run locally](development.md#against-real-spotify) for development).

In Spotify's development mode, the app works for its owner (you; Spotify
Premium required) and up to five users you add under *User Management*.
