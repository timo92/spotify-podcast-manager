# D16 — Compliance with Spotify's Developer Terms and Design Guidelines

**Decision.**
- **Non-commercial.** No ads, no sale of the app or access to it, no in-app
  monetisation. Spotify forbids commercial *streaming* apps, and in-app
  playback via the Web Playback SDK makes this one. Ads would also require
  dropping in-app playback and getting Spotify's approval.
- **Attribution.** Spotify content (metadata, artwork, playback) is always
  shown with the official, unmodified full Spotify logo
  (`frontend/public/spotify/`, from the guidelines' "Full Logo" download):
  - in each page header that lists Spotify content,
  - on the podcast detail page, the episode sheet, the player bar and the
    notes panel,
  - at least 70 px wide, with clear space of half the icon height,
  - linked back to Spotify.
  
  The green logo is only used on pure white surfaces. Elsewhere a
  monochrome logo is used: black on the light page background, white in dark
  mode.
- **Links back** use the wording the guidelines allow ("LISTEN ON SPOTIFY",
  "PLAY ON SPOTIFY"), kept in English as given there.
- **Artwork** is never cropped or overlaid (`object-fit: contain`), with
  4 px corner radius, 8 px on large screens.
- **Own brand.** Accent colour and app icon are indigo instead of Spotify
  Green, and the icon has no Spotify-like shape. The app name doesn't contain
  "Spotify".
- **Retention.** Spotify content is kept only while the app needs it
  (`RETENTION_DAYS` = 30, `backend/src/services/retention.ts`):
  - A podcast removed from the Spotify library is deleted with its episodes,
    progress, notes and plan slots 30 days later, unless it is followed
    again.
  - When Spotify rejects the refresh token (access revoked), the tokens are
    deleted immediately. All other data is deleted 30 days later, unless the
    user logs in again.
  - "Alle Daten löschen" deletes everything immediately.

**Why.** These are conditions of using the Spotify Platform at all: the
Developer Terms and Policy (non-commercial streaming, storing content only as
strictly necessary, deleting a user's data after they disconnect) and the
Design & Branding Guidelines (attribution, artwork, not imitating Spotify).

**Alternatives.**
- *Deleting everything immediately on revocation:* simplest reading of the
  policy, but a refresh failure caused by an accidental revocation would
  wipe the user's own progress and notes without warning. The 30-day window
  is shown in the app.
- *One logo per list row:* noisier, and not required. A logo per screen
  next to the content is the common reading of the guidelines.
