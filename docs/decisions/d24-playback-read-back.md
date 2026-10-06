# D24 — Playback outside the browser is read back on demand

**Decision.**
- Opening an episode reads it back from Spotify (`POST …/episodes/:id/refresh`,
  which fetches `GET /episodes/{id}` and stores what changed, like the sync).
- Playing with the target *Spotify-App* or a Connect device remembers the
  episode in this browser (`localStorage`, 24 hours, at most five). Whenever
  the web app starts or becomes visible again, the remembered episodes are
  read back; an episode is forgotten once heard.
- While the page is visible, the web app polls `GET /api/player/state`
  (Spotify's `GET /me/player`) every 30 seconds and shows a remembered
  episode playing elsewhere in the player bar. It stops after two polls
  without movement or when something else plays, and reads the episode back
  once more.
- Auto-complete, in the browser player and for followed playback, marks an
  episode only once its playback has ended: it was playing close to the end
  (5 seconds in the browser, one poll plus 15 seconds outside it) and then
  stopped, moved on to something else, went back to the beginning or sits at
  the very end. Spotify reports no "finished" event, so the end is inferred
  from the change. Seeking back or closing the player bar is not an end.

**Why.** The scheduled sync (every 2 hours, all episodes only at night) is
too slow for "I just finished it in the Spotify app". Spotify offers no push
for playback changes, so the web app asks when it matters: when an episode is
looked at, when the user comes back, and while both are open side by side.
Mobile browsers pause timers in the background, which is why returning to the
web app triggers its own read-back.

**Alternatives.**
- *Sync more often:* reads every podcast instead of the one being listened
  to, and still lags.
- *Poll `/me/player` on the server (scheduled Lambda):* would work with the
  web app closed, but runs and costs even when nobody listens, and the
  scheduler's minimum is one minute.
- *Remember episodes on the server:* follows the user across devices, but
  needs a store change for what is a per-browser convenience.
