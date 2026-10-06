# Run locally

How to run the app on your machine. The commands for formatting, linting and tests are in [CONTRIBUTING.md](../CONTRIBUTING.md).

Requires Node.js 22+ and pnpm (`corepack enable` picks the version from
`package.json`).

```bash
pnpm install
```

## Demo without Spotify

Fake podcasts, fake login and a fake browser player;
no Spotify app needed:

```bash
pnpm dev:demo        # API on :8787, UI on http://127.0.0.1:5173
```

Open http://127.0.0.1:5173 and click *Log in with Spotify*. All demo wiring
lives in `packages/backend/dev/` and `packages/frontend/dev/`; the app itself
has no demo mode.

## Preview a branch in Codespaces

To try a branch, for example a PR under
review, without checking it out: on the repository page choose *Code →
Codespaces → Create codespace on …* for that branch (on a PR: *Code →
Codespaces* on the PR's branch). The dev container in `.devcontainer/` installs
the packages and starts `pnpm dev:demo`; after a couple of minutes the demo
opens in the browser (port *Demo*, `https://<codespace>-5173.app.github.dev`,
visible only to you). It runs the fake Spotify only. A running codespace uses
the account's Codespaces compute quota and an existing one its storage quota,
so stop or delete it after the review (*github.com/codespaces*).

## Against real Spotify

Needs [your Spotify app](spotify-app.md).

```bash
cp .env.example .env   # fill in SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET
pnpm dev
```

1. Open **http://127.0.0.1:5173**. Use exactly this address, not `localhost`, so it matches the redirect URI.
2. Log in with Spotify. The first account that logs in becomes the owner; the first import starts automatically.

Local data is stored in `packages/backend/.local-data/` (separate from AWS).

```bash
pnpm test            # all tests (DynamoDB via dynalite, CDK assertions)
pnpm typecheck
```
