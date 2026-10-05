# Requirements

Podcast-Cockpit is a personal web app in front of Spotify. When opened, it
answers within seconds: **what is new in my current-affairs podcasts, and
which episode of my long-running series is next?** It does not replace
Spotify; playback always happens through Spotify.

Status column: ✅ implemented · ⏳ planned.

## 1. Users and scope

| ID | Requirement | Status |
| --- | --- | --- |
| U1 | The app serves exactly one user (its owner). Multi-user, sharing and social features are out of scope. | ✅ |
| U2 | The app runs in the owner's own AWS account and is reachable under the owner's domain. | ✅ |

## 2. Spotify integration

| ID | Requirement | Status |
| --- | --- | --- |
| S1 | The user logs in with Spotify (OAuth). The app never sees or stores the Spotify password. | ✅ |
| S2 | The first Spotify account that logs in becomes the owner; all other accounts are rejected. | ✅ |
| S3 | The Spotify developer app's client ID and secret are part of the deployment configuration (environment/CI variables). The secret is stored encrypted outside of the infrastructure templates and is never shown in the UI. | ✅ |
| S4 | The app imports the shows saved in the user's Spotify library and their episodes: ID, title, description, cover, release date, duration, Spotify link and Spotify's resume point. | ✅ |
| S5 | Spotify access is encapsulated in one service layer. Only documented Web API endpoints are used. | ✅ |
| S6 | Spotify tokens stay on the server. The browser receives only a short-lived access token, and only for the in-browser player. | ✅ |
| S7 | Rate limits (HTTP 429), expired tokens and missing permissions are handled and explained to the user in plain language. | ✅ |

## 3. Consumption modes

Each podcast has exactly one mode.

| ID | Requirement | Status |
| --- | --- | --- |
| M1 | **Latest** (news-like): the newest episode is suggested, as long as it has not been heard or skipped. Once it has been, nothing older is suggested until a new episode appears. | ✅ |
| M2 | **Sequential** (series): an episode already started is suggested first. Otherwise the app continues with the first unheard episode after the last finished one; unheard episodes before that point only come back once the end is reached. | ✅ |
| M3 | **Manual:** only the episode the user picked is suggested. Where a planned slot has no episode chosen yet (Today, Week), the user can pick one right there. | ✅ |
| M4 | In every mode the user can pin a specific episode as "next"; the pin wins until that episode is heard or skipped. | ✅ |
| M5 | Sequential podcasts can optionally re-offer skipped episodes once everything else has been heard. | ✅ |
| M6 | Newly imported podcasts get a guessed mode (frequent publishers → Latest) and guessed categories, which the user confirms in a review step. | ✅ |

## 4. Listening progress

| ID | Requirement | Status |
| --- | --- | --- |
| P1 | Each episode has a status: unheard, started, heard or skipped. The user can set any status, reset it, and mark all earlier episodes of a podcast as heard at once. | ✅ |
| P2 | Personal status is stored separately from Spotify metadata. Synchronising never changes it. | ✅ |
| P3 | Spotify's resume point is shown as progress. Episodes Spotify reports as fully played count as heard unless the user marked them otherwise; this can be switched off. | ✅ |
| P4 | Episodes released within a configurable number of days (default 7) and not yet heard are marked "new". For Latest podcasts only the newest episode counts as new. | ✅ |
| P5 | A history lists the episodes heard most recently. | ✅ |

## 5. Views

| ID | Requirement | Status |
| --- | --- | --- |
| V1 | **Today:** today's slots from the weekly plan (with finished ones ticked off), then the next episodes of the remaining podcasts that fit into the daily time budget, then further suggestions, podcasts without a new episode, and recently heard episodes. | ✅ |
| V2 | **Week:** a recurring weekly plan made of rules: a podcast on one or more weekdays at a part of day (morning, midday, evening, anytime); a podcast can have several rules. The plan is shown per day. Editing a slot edits its rule for all of its weekdays; removing a slot removes either that day or the whole rule. Each slot shows the concrete episode it will be – consecutive episodes for a series planned several times a week; a manual podcast shows its chosen episode in every slot until it is heard, a news podcast its newest episode in every slot of today. A slot's podcast name and cover lead to the podcast. An edit never undoes a change made to the plan in another tab or on another device in the meantime: it is applied to the current plan instead. | ✅ |
| V3 | **Podcasts:** every podcast with cover, mode, categories, progress, number of new episodes, next episode, last heard episode and time of the last sync. Filterable by category and paused state; sortable by priority. | ✅ |
| V4 | **Podcast detail:** description, settings, its rules in the weekly plan (add, edit, remove, as on the Week page), progress, and all episodes with search, status filters (all, unheard, new, started, heard, skipped), sorting and per-episode actions. | ✅ |
| V5 | **Episode:** title, release date, duration, full description, status, progress in percent, notes and all actions. | ✅ |
| V6 | Status labels are clearly distinguishable: new, continue, next, chosen, heard, skipped, no new episode. | ✅ |

## 6. Planning and prioritisation

| ID | Requirement | Status |
| --- | --- | --- |
| B1 | The user sets a daily audio time budget (minutes) and a tolerance (percent). | ✅ |
| B2 | Suggestions are picked in the user's priority order as long as they fit into the budget. Planned slots count against the budget first. Already started episodes count with their remaining time only. | ✅ |
| B3 | The user can reorder podcasts by priority, pause a podcast, or remove it from Today while still tracking it. | ✅ |
| B4 | Categories are free-form; a podcast can have several. A default set is provided (news, politics, economy, history, geography, philosophy, science, society, other). | ✅ |

## 7. Playback and notes

| ID | Requirement | Status |
| --- | --- | --- |
| L1 | An episode can be played in the browser (Spotify Premium), on any Spotify Connect device, or opened in the Spotify app. Playback resumes at Spotify's resume point; the user can also start from the beginning. | ✅ |
| L2 | When an episode ends in the browser player, it can automatically be marked as heard (with undo). | ✅ |
| L3 | The user can write notes per episode, including while listening. While playing in the browser, the current position can be inserted as a timestamp; clicking a timestamp later jumps to that position. Notes are searchable, can be grouped by podcast (in episode order) and limited to a period of their last edit (this week, last 30 days, this year or a custom range); grouping and period are remembered per browser. | ✅ |

## 8. Synchronisation

| ID | Requirement | Status |
| --- | --- | --- |
| Y1 | New episodes are fetched automatically every 2 hours; all metadata is refreshed once a day; the user can trigger both manually and per podcast. | ✅ |
| Y2 | Synchronisation is idempotent. A failure for one podcast does not stop the others, and the app stays usable when Spotify is unreachable. | ✅ |
| Y3 | Podcasts removed from the Spotify library are kept with their progress, but no longer suggested. | ✅ |

## 9. Privacy and data

| ID | Requirement | Status |
| --- | --- | --- |
| D1 | Only the data needed for the features is stored; nothing is sent to third parties except the necessary Spotify API calls. | ✅ |
| D2 | All personal data (settings, progress, plan, notes) can be exported as JSON. | ✅ |
| D3 | All data, including credentials and tokens, can be deleted from within the app. | ✅ |
| D4 | Personal data is backed up continuously (point-in-time recovery) and survives the removal of the stack. | ✅ |
| D5 | Spotify content is kept only while needed: podcasts removed from the Spotify library are deleted (with progress, notes and plan slots) 30 days later unless followed again. | ✅ |
| D6 | When Spotify access is revoked, the app stops using Spotify immediately (tokens deleted), shows the deletion date, and deletes all data 30 days later unless the user logs in again. | ✅ |

## 10. Non-functional

| ID | Requirement | Status |
| --- | --- | --- |
| N1 | Mobile-first UI that also works well on desktop; light and dark mode (system default, switchable). | ✅ |
| N2 | Deployable with AWS CDK, optionally on a custom domain with TLS. | ✅ |
| N3 | Running costs in the range of cents per month for one user (plus an optional Route 53 hosted zone). | ✅ |
| N4 | The Spotify integration can be replaced, e.g. by a fake for development and tests or by further sources. | ✅ |
| N5 | The UI is available in German and English. The language follows the browser and can be chosen in the settings (remembered per browser). Dates and durations are formatted for the active language. | ✅ |
| N6 | The app follows Spotify's Design & Branding Guidelines: official Spotify logo next to Spotify content, approved link wording, uncropped artwork with 4/8 px corners, and an own visual identity (no Spotify Green, no Spotify-like name or icon). | ✅ |
| N7 | The app is non-commercial: no ads, no paid access, no in-app monetisation (Spotify forbids commercial streaming apps). | ✅ |

## 11. Out of scope for now

- Further sources such as YouTube channels/playlists, with the same modes ⏳
- Tags per episode, statistics, one-off plan entries for specific dates ⏳
- An own audio or video player, podcast hosting, recommendations from other
  users, AI summaries, transcription, multi-user management, public profiles
