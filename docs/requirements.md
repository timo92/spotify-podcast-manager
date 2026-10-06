# Requirements

Podcast-Cockpit is a personal web app in front of Spotify. When opened, it
answers within seconds: **what is new in my current-affairs podcasts, and
which episode of my long-running series is next?** It does not replace
Spotify; playback always happens through Spotify.

What the app does, from the user's point of view. Each requirement keeps its
ID so it can be referenced. How exactly a screen looks or behaves is pinned
down by the tests, not here; open work lives in GitHub issues.

## Users and scope

- **U1** The app serves exactly one user, its owner. Multi-user, sharing and
  social features are out of scope.
- **U2** It runs in the owner's own AWS account, under the owner's domain.

## Spotify integration

- **S1** The user logs in with Spotify (OAuth). The app never sees or stores
  the Spotify password.
- **S2** The first Spotify account that logs in becomes the owner; all other
  accounts are rejected.
- **S3** The Spotify app's client ID and secret come from the deployment. The
  secret is stored encrypted outside the infrastructure templates and is never
  shown in the UI.
- **S4** The app imports the shows saved in the user's Spotify library and
  their episodes, including Spotify's resume point.
- **S5** All Spotify access goes through one service layer, using documented
  Web API endpoints only.
- **S6** Spotify tokens stay on the server. The browser gets only a
  short-lived access token, for the in-browser player.
- **S7** Rate limits, expired tokens and missing permissions are handled and
  explained in plain language.

## Consumption modes

Each podcast has exactly one mode.

- **M1** **Latest** (news): the newest episode is suggested until it is heard
  or skipped; then the newest one still unheard among the recent episodes
  (the "new" window). Older episodes are not suggested.
- **M2** **Sequential** (series): a started episode comes first; otherwise the
  first unheard episode after the last finished one. Unheard episodes before
  that point only come back once the end is reached.
- **M3** **Manual:** only the episode the user picked is suggested. Where a
  planned slot has no episode yet, the user can pick one right there.
- **M4** In every mode the user can pin an episode as "next"; the pin wins
  until that episode is heard or skipped.
- **M5** Sequential podcasts can re-offer skipped episodes once everything
  else has been heard.
- **M6** Newly imported podcasts get a guessed mode and guessed categories,
  which the user confirms in a review step.

## Listening progress

- **P1** Each episode is unheard, started, heard or skipped. The user can set
  or reset any status, and mark all earlier episodes of a podcast as heard at
  once.
- **P2** Personal status is stored separately from Spotify metadata;
  synchronising never changes it.
- **P3** Spotify's resume point is shown as progress. Episodes Spotify reports
  as fully played count as heard unless the user marked them otherwise; this
  can be switched off.
- **P4** Unheard episodes released within a configurable number of days
  (default 7) are marked "new"; for Latest podcasts only the newest one.
- **P5** A history lists the episodes heard most recently.
- **P6** Progress made in the Spotify app or on another device shows up
  without waiting for a sync: when an episode is opened, when the user returns
  to the web app, and in the player bar while the web app is open.

## Views

- **V1** **Today:** today's slots from the weekly plan (finished ones ticked
  off), then the next episodes of the other podcasts that fit into the daily
  budget, then further suggestions, podcasts without a new episode, and
  recently heard episodes.
- **V2** **Week:** a recurring weekly plan made of rules: a podcast on some
  weekdays at a part of day; a podcast can have several rules. The plan is
  shown per day, each slot with the episode it will be. A slot is edited as
  its rule and can be removed for one day or as a whole. An edit never undoes
  a change made elsewhere in the meantime.
- **V3** **Podcasts:** every podcast with its mode, categories, progress, new
  episodes, next episode and last sync; filterable by category and paused
  state, sortable by priority.
- **V4** **Podcast detail:** description, settings, its rules in the weekly
  plan, progress, and all episodes with search, status filters, sorting and
  per-episode actions.
- **V5** **Episode:** title, release date, duration, description, status,
  progress, notes and all actions.
- **V6** Status labels are clearly distinguishable: new, continue, next,
  chosen, heard, skipped, no new episode.

## Planning and prioritisation

- **B1** The user sets a daily listening budget (minutes) and a tolerance
  (percent).
- **B2** Suggestions are picked in the user's priority order while they fit
  into the budget. Planned slots count first; started episodes count with
  their remaining time only.
- **B3** The user can reorder podcasts, pause a podcast, or hide it from Today
  while still tracking it.
- **B4** Categories are free-form, several per podcast, with a default set to
  start from.

## Playback and notes

- **L1** An episode plays in the browser (Spotify Premium), on any Spotify
  Connect device, or in the Spotify app, from Spotify's resume point or from
  the beginning. If a listed Connect device can't be reached, the app says so
  and offers to open the episode in Spotify.
- **L2** Once an episode has ended, in the browser player or elsewhere while
  the web app follows it, it can be marked as heard automatically (with undo).
- **L3** The user can write any number of notes per episode, also while
  listening. Each note has a position in the episode (or none, for the whole
  episode); a new note takes the position the episode is playing at, wherever
  it plays. Notes can be edited and deleted one by one. An episode's notes are
  listed by position, and a position jumps there.
- **L4** All notes can be searched, grouped by podcast and limited to when
  they were written; these choices are remembered per browser.

## Synchronisation

- **Y1** New episodes are fetched every 2 hours and all metadata once a day;
  the user can trigger both, also per podcast.
- **Y2** Synchronisation is idempotent. A failure for one podcast doesn't stop
  the others, and the app stays usable when Spotify is unreachable.
- **Y3** Podcasts removed from the Spotify library keep their progress but are
  no longer suggested.
- **Y4** The app shows how long ago the last sync finished, and its exact
  date and time on request, kept current while the app is open.

## Privacy and data

- **D1** Only data needed for the features is stored; nothing is sent to third
  parties except the necessary Spotify API calls.
- **D2** All personal data (settings, progress, plan, notes) can be exported
  as JSON.
- **D3** All data, including credentials and tokens, can be deleted from
  within the app.
- **D4** Personal data is backed up continuously (point-in-time recovery) and
  survives the removal of the stack.
- **D5** Podcasts removed from the Spotify library are deleted, with their
  progress, notes and plan slots, 30 days later unless followed again.
- **D6** When Spotify access is revoked, the app stops using Spotify at once
  (tokens deleted), shows the deletion date, and deletes all data 30 days
  later unless the user logs in again.

## Non-functional

- **N1** Mobile-first UI that also works on desktop; light and dark mode
  (system default, switchable).
- **N2** Deployable with AWS CDK, optionally on a custom domain with TLS.
- **N3** Running costs in the range of cents per month for one user (plus an
  optional Route 53 hosted zone).
- **N4** The Spotify integration is replaceable, e.g. by a fake for
  development and tests or by further sources.
- **N5** The UI is available in German and English. The language follows the
  browser and can be chosen in the settings; dates and durations follow it.
- **N6** The app follows Spotify's Design & Branding Guidelines: official
  Spotify logo next to Spotify content, approved link wording, uncropped
  artwork with 4/8 px corners, and an own visual identity (no Spotify Green,
  no Spotify-like name or icon).
- **N7** The app is non-commercial: no ads, no paid access, no in-app
  monetisation (Spotify forbids commercial streaming apps).

## Out of scope

Ideas for later:

- Further sources such as YouTube channels or playlists, with the same modes.
- Tags per episode, statistics, one-off plan entries for specific dates.

Not planned:

- An own audio or video player, podcast hosting, recommendations from other
  users, AI summaries, transcription, multi-user management, public profiles.
