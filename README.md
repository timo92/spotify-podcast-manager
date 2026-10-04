# Podcast-Cockpit

A personal web app that sits in front of Spotify and answers one question when
you open it: **what's new in my news podcasts, and which episode of my
long-running series is next?**

Each podcast gets a *consumption mode*:

| Mode | German UI | Behaviour |
| --- | --- | --- |
| `LATEST` | Aktualität | Suggests the newest episode, but only if you haven't finished or skipped it yet. |
| `SEQUENTIAL` | Reihenfolge | Works through the show oldest-first and continues after the last episode you finished. |
| `MANUAL` | Frei | Suggests only the episode you chose yourself. |

The **Heute** (Today) page builds a short list from your daily time budget,
sorted by your podcast priorities. You can play an episode in the browser
(Spotify Web Playback SDK, Premium), on any Spotify Connect device (phone,
speaker…), or open it in the Spotify app.

The UI is in German. The code and docs are in English.

![Architecture](docs/architecture.svg)

## Features

- **Spotify login (OAuth).** The first Spotify account that logs in becomes the owner, and every other account is rejected. The Spotify password never touches the app.
- **Setup in the browser.** You type the Spotify Client ID and Secret on the setup page, so no secrets go into the deployment. A one-time setup code from `cdk deploy` protects the setup page until you have claimed the app.
- **Import of your saved shows**, with a guessed mode and categories (daily shows → `LATEST`, plus keyword-based categories). A review screen lets you confirm the guesses quickly.
- **Idempotent sync**: new episodes every 2 hours, a full refresh every night, and manual sync at any time. A sync only writes metadata. Your personal progress is stored in separate records and is never overwritten.
- **Spotify's listening state is used as a hint.** Episodes that are partly played in Spotify show up as *Weiter* (continue), with the remaining time. Episodes that Spotify reports as fully played count as heard. You can turn that off in the settings, and your own marks always win.
- **Actions on each episode:** heard, unheard, skip, set as next episode, "mark all earlier episodes as heard", reset to the Spotify state, open in Spotify.
- **Podcast settings:** mode, multiple categories (free-form), pause, hide from Today, re-offer skipped episodes, and priority order.
- **Daily budget** with tolerance. Episodes are picked in your priority order, counting only the remaining time of episodes you have already started.
- **Other pages:** a history page, a JSON export, and "delete all data".
- **Mobile-first UI** with light/dark mode. It can be installed as a home-screen app.
- **Offline demo mode** with generated podcasts (`npm run dev:demo`).

## Repository layout

```
packages/
  shared/    domain types + pure logic (next-episode selection, budget, heuristics)
  backend/   Lambda handlers, Spotify service layer, DynamoDB/in-memory stores, local dev server
  frontend/  React SPA (Vite, TanStack Query, React Router)
  infra/     AWS CDK app
docs/        architecture, Spotify API notes
```

## Run locally

Requires Node.js 22+.

```bash
npm install

# Offline demo with fake Spotify data – no Spotify app needed.
# API on :8787, UI on http://127.0.0.1:5173 (any client ID/secret works):
npm run dev:demo
```

To run against real Spotify, use `npm run dev` instead and
register `http://127.0.0.1:5173/api/auth/callback` as a redirect URI in your
Spotify app. Spotify only allows plain `http` for loopback IPs, not `localhost`.
Local data is stored in `packages/backend/.local-data/`.

```bash
npm test         # all unit/integration tests (DynamoDB via dynalite, CDK assertions)
npm run typecheck
```

## Deploy to AWS

### 1. Configure

Edit `packages/infra/cdk.json` (or pass `-c key=value` to `cdk`):

| Context key | Example | Notes |
| --- | --- | --- |
| `domainName` | `podcasts.example.com` | Optional. Without it, the app runs on the CloudFront domain. |
| `hostedZoneName` | `example.com` | Defaults to the parent domain of `domainName`. Must be a Route 53 hosted zone in the same account. |
| `certificateArn` | `arn:aws:acm:us-east-1:…` | Only if your DNS is **not** in Route 53. The certificate must be in us-east-1. You then point a CNAME at the `DistributionDomain` output yourself. |
| `setupCode` | | Optional. If empty, a code is generated once and kept in `packages/infra/.setup-code` (git-ignored). |

The main stack goes to `CDK_DEFAULT_REGION` (your AWS profile's region). If
none is set, it goes to `eu-central-1`. With a Route 53 domain, a small extra
stack creates the TLS certificate in `us-east-1`, which CloudFront requires.

### 2. Bootstrap (once per account/region)

```bash
cd packages/infra
npx cdk bootstrap aws://<ACCOUNT>/eu-central-1 aws://<ACCOUNT>/us-east-1
```

### 3. Deploy

```bash
npm run deploy          # from the repo root: builds the frontend, then `cdk deploy --all`
```

The outputs show `Url`, `SpotifyRedirectUri` and `SetupCode`.

### 4. Create the Spotify app and finish the setup

1. In the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), create an app.
   - Under **APIs used**, select *Web API* and *Web Playback SDK*.
   - Under **Redirect URIs**, add the `SpotifyRedirectUri` output, e.g. `https://podcasts.example.com/api/auth/callback`.
2. Open the `Url`. Enter the setup code, Client ID and Client Secret, then log in with Spotify.
3. The first import runs automatically. Then confirm the guessed mode and categories under **Podcasts → Prüfen**.

### Costs

For one user, this stays in or near the AWS free tier: Lambda, DynamoDB on-demand, API Gateway and CloudFront each cost a few cents at most. A Route 53 hosted zone costs $0.50 per month. Point-in-time recovery for DynamoDB is enabled, and on such a tiny table it costs fractions of a cent.

## How it works

- **Single origin.** CloudFront serves the SPA from S3 and forwards `/api/*` to API Gateway (HTTP API) and a Lambda function. The session cookie is first-party (`HttpOnly`, `Secure`, `SameSite=Lax`), so there is no CORS. Requests that change data must be sent as JSON, which works as a simple CSRF guard.
- **Tokens stay on the server.** Spotify access and refresh tokens are kept in DynamoDB. The browser only gets a short-lived access token for the Web Playback SDK, which needs one.
- **Sync** runs in a separate Lambda function: asynchronously from the API (because API Gateway times out after 29 s), every 2 hours, and once a day as a full refresh. It runs with a reserved concurrency of 1, so two syncs never run at once.
- **Data model:** one DynamoDB table. Episodes (`EP#<show>`) and progress (`PROG#<show>`) are separate items, so a sync can never overwrite your progress. Each show item carries a summary (next episode, counts) that is recomputed after every change. That way, "Heute" and the overview only need to read the list of shows. Details are in [`packages/backend/src/store/dynamo.ts`](packages/backend/src/store/dynamo.ts).
- **Spotify layer:** [`packages/backend/src/spotify`](packages/backend/src/spotify). It refreshes tokens (including rotated refresh tokens), retries on 429 using `Retry-After` and on 5xx errors, and turns 401/403 into readable messages. The `SpotifyApi` interface can be replaced, for example by the offline fake or a future YouTube source. See [docs/spotify-api.md](docs/spotify-api.md) for the endpoints used and the 2026 restrictions for apps in development mode.

## Resetting

- **Wrong Spotify account, or locked out:** delete the item `PK=META, SK=CONFIG` from the DynamoDB table, then run the setup again. This keeps your progress.
- **Delete everything:** go to Settings → *Alle Daten löschen*. The table itself has a `Retain` policy, so it survives `cdk destroy`.

## Not in this MVP (ideas for later)

- YouTube channels/playlists as a second source. The data model already has a `source` field, and the Spotify layer sits behind an interface.
- Notes and tags per episode, statistics, a calendar view.
- Smarter daily planning (knapsack instead of greedy, weekday-specific budgets).
- Push notification when a priority show has a new episode.
