# D12 — Playback through Spotify, not our own player

**Decision.** Three targets: the Spotify Web Playback SDK in the browser,
any Spotify Connect device, or a deep link into the Spotify app. On mobile
browsers (no SDK support) the app link is the default.

**Why.** Spotify's terms and DRM rule out streaming audio ourselves, and
playing through Spotify keeps Spotify's own resume points in sync.
