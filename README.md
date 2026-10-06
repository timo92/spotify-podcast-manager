# Podcast-Cockpit

A personal web app that sits in front of Spotify and answers one question when
you open it: **what's new in my news podcasts, and which episode of my
long-running series is next?**

Each podcast gets a *consumption mode*:

| Mode | In the UI | Behaviour |
| --- | --- | --- |
| `LATEST` | Latest | Suggests the newest episode, but only if you haven't finished or skipped it yet. |
| `SEQUENTIAL` | In order | Works through the show oldest-first and continues after the last episode you finished. |
| `MANUAL` | Manual | Suggests only the episode you chose yourself. |

The **Week** page is a recurring weekly plan: for example, the news
on weekday mornings and your history series on Tuesday and Thursday
evenings. For every slot the app picks the concrete episode, so a series
planned twice a week shows episode n on Tuesday and n+1 on Thursday. The
**Today** page puts today's slots on top, ticks off what you've
finished, and fills the rest of your daily time budget by priority. You can play an episode in the browser
(Spotify Web Playback SDK, Premium), on any Spotify Connect device (phone,
speaker…), or open it in the Spotify app.

The UI is in German and English (following the browser, switchable in
*Settings*). The code and docs are in English.

![Architecture](docs/architecture.svg)

## Features

- **Spotify login (OAuth).** The first Spotify account that logs in becomes the owner, and every other account is rejected. The Spotify password never touches the app.
- **Configuration as part of the deployment.** The Spotify client ID comes from `.env` or CI variables; the client secret lives in SSM Parameter Store and never appears in code or templates. There is no setup page.
- **Import of your saved shows**, with a guessed mode and categories (daily shows → `LATEST`, plus keyword-based categories). A review screen lets you confirm the guesses quickly.
- **Idempotent sync**: new episodes every 2 hours, a full refresh every night, and manual sync at any time. A sync only writes metadata. Your personal progress is stored in separate records and is never overwritten.
- **Listening in the Spotify app**: an episode started there (or on a Connect device) is read back from Spotify when you return to the web app, and followed in the player bar every 30 seconds while the web app is open. Opening an episode also reads its latest progress from Spotify.
- **Spotify's listening state is used as a hint.** Episodes that are partly played in Spotify show up as *Continue*, with the remaining time. Episodes that Spotify reports as fully played count as heard. You can turn that off in the settings, and your own marks always win.
- **Weekly plan** of recurring rules: a podcast on some weekdays at a part of day (morning, midday, evening, anytime), e.g. "weekdays in the morning". A podcast can have several rules, editable on *Week* or on the podcast's page. Their slots are projected onto concrete episodes for the next 7 days, and episodes you finish today are ticked off in the plan.
- **Next and last heard per podcast**, shown in the overview for every podcast.
- **Notes on episodes**: any number per episode, each at the position where it was written, whether you listen in the browser or in the Spotify app. Tapping a position jumps back to that point. Notes can be edited and deleted one by one, are searchable under History → Notes and are included in the export.
- **Actions on each episode:** heard, unheard, skip, set as next episode, "mark all earlier episodes as heard", reset to the Spotify state, open in Spotify.
- **Podcast settings:** mode, multiple categories (free-form), pause, hide from Today, re-offer skipped episodes, and priority order.
- **Daily budget** with tolerance. Episodes are picked in your priority order, counting only the remaining time of episodes you have already started.
- **Other pages:** a history page, a JSON export, and "delete all data".
- **Mobile-first UI** with light/dark mode. It can be installed as a home-screen app.
- **Offline demo** with generated podcasts (`pnpm dev:demo`).

## Getting started

- **Try it without Spotify:** `pnpm install && pnpm dev:demo`, then open http://127.0.0.1:5173 ([details](docs/development.md)).
- **Create your Spotify app** (Client ID and secret, redirect URIs): [docs/spotify-app.md](docs/spotify-app.md).
- **Run locally against Spotify,** or preview a branch in Codespaces: [docs/development.md](docs/development.md).
- **Deploy to AWS** (configuration, secret, costs, resetting): [docs/deployment.md](docs/deployment.md).
- **How it works** (single origin, cookies, sync, data model): [docs/architecture.md](docs/architecture.md).

## Repository layout

```
packages/
  shared/      domain types + pure logic (next-episode selection, budget, weekly plan)
  backend/
    src/       Hono API, Lambda handlers, Spotify service layer, DynamoDB/in-memory stores
    dev/       local development server
    test/      tests and fakes (fake Spotify)
  frontend/
    src/       React SPA (Vite, TanStack Query, React Router)
    dev/       development-only helpers (fake Web Playback SDK)
    test/      tests
  infra/       AWS CDK app
docs/          requirements, architecture decisions, Spotify API notes
```

Why it is built this way: [docs/decisions/](docs/decisions/README.md). What it
does: [docs/requirements.md](docs/requirements.md). How code, commits and pull
requests are written: [CONTRIBUTING.md](CONTRIBUTING.md).

## Spotify's terms

The app uses the Spotify Platform under Spotify's
[Developer Terms](https://developer.spotify.com/terms),
[Developer Policy](https://developer.spotify.com/policy) and
[Design & Branding Guidelines](https://developer.spotify.com/documentation/design).
In short (details in [D16](docs/decisions/d16-spotify-compliance.md)):

- **Non-commercial.** It plays episodes in the browser, which makes it a
  *streaming* app, and those may not be commercial: no ads, no paid access.
- **Attribution.** Spotify content is shown with the official Spotify logo
  (unmodified files in `packages/frontend/public/spotify/`) and links back
  to Spotify.
- **Retention.** Podcasts you unfollow in Spotify are deleted after 30 days.
  If you revoke the app's access in your Spotify account, it stops using
  Spotify immediately and deletes your data after 30 days, unless you log in
  again.

## Not in this MVP (ideas for later)

- YouTube channels/playlists as a second source. The data model already has a `source` field, and the Spotify layer sits behind an interface.
- Tags per episode, statistics.
- One-off plan entries for specific dates (on top of the recurring weekly plan).
- Smarter daily planning (knapsack instead of greedy, weekday-specific budgets).
- Push notification when a priority show has a new episode.
