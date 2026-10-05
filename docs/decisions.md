# Architecture decisions

Short records of the choices behind this project: what was decided, why, and
what was considered instead. Add a new entry when a decision changes rather
than rewriting history; mark the old one as superseded.

Context that shapes almost every decision: **one user**, personal use,
deployed into the owner's own AWS account, low traffic, low budget, and the
wish to keep operations close to zero.

---

## D1 — Monorepo with four packages

**Decision.** One repository with pnpm workspaces:

| Package | Contents | Depends on |
| --- | --- | --- |
| `packages/shared` | Domain types and pure logic (next-episode selection, budget, weekly plan projection, heuristics) | – |
| `packages/backend` | HTTP API, sync, Spotify client, stores; `dev/` local server, `test/` tests and fakes | shared |
| `packages/frontend` | React SPA; `dev/` development-only helpers | shared |
| `packages/infra` | AWS CDK app | (bundles backend, uploads frontend build) |

**Why.** Frontend and backend share the API contract as TypeScript types, so
a changed field breaks the build instead of production. The domain rules live
in `shared` without any I/O, so they are trivially unit-testable. One
repository keeps a feature (UI + API + infrastructure) in a single PR.

**Alternatives.** Separate repositories (overhead without benefit for one
developer); a single package (blurs the boundary between pure logic and
adapters).

## D2 — pnpm as package manager

**Decision.** pnpm workspaces (`pnpm-workspace.yaml`, `workspace:*`
dependencies). Install scripts are blocked by default and allowed only for
`esbuild` and `classic-level`.

**Why.** Strict dependency resolution (a package can only import what it
declares), fast installs through a content-addressed store, and an explicit
allow-list for install scripts as a supply-chain safeguard.

## D3 — React single-page app built with Vite

**Decision.** React 19 + TypeScript, Vite, React Router, TanStack Query for
server state. No SSR.

**Why.**
- The app sits behind a login and needs no SEO, so server rendering adds cost
  and moving parts without benefit. A static build on S3/CloudFront is the
  cheapest and simplest hosting there is.
- The Spotify Web Playback SDK runs in the browser anyway.
- React has the largest ecosystem and is familiar; TanStack Query covers
  caching, refetching and invalidation, so no global state library is needed.

**Alternatives.** Next.js (needs a server runtime or Amplify Hosting; SSR not
needed); Vue/Svelte (equally viable; React chosen for ecosystem and
familiarity).

## D4 — REST API on API Gateway HTTP API + one Lambda, written with Hono

**Decision.** A small REST/JSON API served by a single Lambda function
("Lambdalith") behind an API Gateway HTTP API. Routing, cookies and the
Lambda adapter come from [Hono](https://hono.dev); request/response are the
web-standard `Request`/`Response`.

**Why.**
- About 30 endpoints with fixed shapes – REST is the simplest fit.
- One function means one cold start, one log group and one bundle; there is
  no scale or team boundary that would justify a function per route.
- HTTP API is cheaper and simpler than REST API (v1); the features REST API
  adds (API keys, usage plans, request validation) are not needed.
- Hono runs the same app on Lambda (`@hono/aws-lambda`) and locally on Node
  (`@hono/node-server`) and in tests (`app.request()`), so there is no custom
  HTTP abstraction to maintain.

**Alternatives.**
- *AppSync (GraphQL), e.g. via Amplify:* adds a schema, resolvers and an auth
  model built around Cognito/IAM/API keys. Our login is Spotify OAuth with an
  app-owned session, which AppSync would only support through a Lambda
  authorizer – more pieces for no gain. GraphQL's flexibility pays off with
  many clients or deeply nested data; here there is one client and a handful
  of views. Amplify would also take over hosting and infrastructure that CDK
  already describes explicitly.
- *Lambda Function URL instead of API Gateway:* viable and slightly cheaper,
  but API Gateway gives throttling for free.
- *Express/Fastify with an adapter:* heavier and built around Node's
  `http` types rather than web standards.

## D5 — One CloudFront distribution for site and API

**Decision.** CloudFront serves the SPA from a private S3 bucket and routes
`/api/*` to API Gateway. A CloudFront Function rewrites client-side routes to
`index.html`; another forwards the viewer host as `x-public-host`.

**Why.** Same origin: cookies are first-party and there is no CORS at all.
One certificate, one domain, HTTPS everywhere.

## D6 — Login with Spotify only; server-side sessions

**Decision.**
- The first Spotify account that logs in becomes the owner; any other
  account is rejected.
- Sessions are random IDs stored in DynamoDB (TTL 90 days), sent as an
  `HttpOnly`, `Secure`, `SameSite=Strict` cookie.
- The short-lived OAuth `state` cookie is `SameSite=Lax`, because Spotify's
  redirect back to `/api/auth/callback` is a cross-site navigation and browsers
  drop `Strict` cookies on those.
- Requests that change data must be JSON (a CSRF guard on top of `SameSite`).
- A setup code (generated at deploy time, printed as a stack output) protects
  the setup page until the owner has logged in once.

**Why.** The user needs a Spotify login anyway. A second identity system
(Cognito) would mean a second password for a single person. Server-side
sessions can be revoked (logout, "delete all data"), unlike stateless tokens.

## D7 — Spotify credentials entered in the UI, stored in DynamoDB

**Decision.** Client ID/secret are entered on the setup page and stored in
the app's DynamoDB table (encrypted at rest). Spotify access/refresh tokens
live there too and never reach the browser, except a short-lived access token
for the Web Playback SDK.

**Why.** Requirement: no secrets in the deployment configuration. DynamoDB
encryption at rest is on by default.

**Alternatives.** Secrets Manager or SSM SecureString (better audit trail and
rotation support, but $0.40/secret/month for Secrets Manager and extra IAM
plumbing). A customer-managed KMS key is a cheap later hardening step.

## D8 — DynamoDB single table, on-demand

**Decision.** One table (`PK`/`SK`, one GSI for history and notes), on-demand
billing. Episode metadata (written by the sync) and personal progress
(written by the user) are separate items; every show item carries a
denormalised summary that is recomputed after each change.

**Why.** Pay-per-request costs cents for one user and needs no capacity
planning, patching or VPC (unlike RDS/Aurora). Separate items make it
impossible for a sync to overwrite personal progress. The summaries let
"Heute" and the overview read a single partition instead of every episode.

## D9 — Point-in-time recovery and `Retain` for the table

**Decision.** PITR is enabled; the table has `RemovalPolicy.RETAIN`.

**Why.** Listening progress, the weekly plan and notes cannot be recreated
from Spotify – metadata can, personal history cannot. PITR restores the table
to any second of the last 35 days after a bug, a bad deploy or an accidental
"delete all data". It costs roughly $0.20 per GB-month, and this table is a
few megabytes. `Retain` keeps the data even if the stack is destroyed.

**Alternatives.** On-demand backups (manual, easy to forget); no backups
(cheapest, but one bug away from losing everything).

## D10 — Sync in a separate Lambda, triggered asynchronously

**Decision.** The API invokes a sync Lambda asynchronously; EventBridge runs
it every 2 hours (incremental) and nightly (full). Reserved concurrency 1.

**Why.** A first import can take minutes, but API Gateway times out after
29 seconds. Reserved concurrency 1 guarantees there is never more than one
sync running. Incremental syncs stop paging at the first known episode, which
keeps Spotify API usage low.

## D11 — AWS CDK in TypeScript

**Decision.** All infrastructure in one CDK app (requirement). The TLS
certificate lives in a small us-east-1 stack because CloudFront only accepts
certificates from there. Lambdas run on Node.js 22, arm64, bundled as ESM by
esbuild, with the AWS SDK taken from the runtime.

**Why.** Same language as the app; constructs such as `NodejsFunction` and
`BucketDeployment` remove most boilerplate. arm64 is cheaper per GB-second.

## D12 — Playback through Spotify, not our own player

**Decision.** Three targets: the Spotify Web Playback SDK in the browser,
any Spotify Connect device, or a deep link into the Spotify app. On mobile
browsers (no SDK support) the app link is the default.

**Why.** Spotify's terms and DRM rule out streaming audio ourselves, and
playing through Spotify keeps Spotify's own resume points in sync.

## D13 — Spotify listening state counts by default

**Decision.** Episodes that Spotify reports as fully played count as heard
unless the user has marked them; the setting can be turned off.

**Why.** The user listens in Spotify. Without this, a series already half
heard in Spotify would start again at episode 1. Explicit marks in the app
always take precedence, and a sync never writes personal progress.

## D14 — Plain CSS with design tokens, lucide icons

**Decision.** Plain CSS split by area under `frontend/src/styles/`, colours as
custom properties defined once with `light-dark()`; icons from `lucide-react`.

**Why.** Modern CSS (custom properties, nesting, `light-dark()`, `:has()`)
covers what SASS used to be needed for, without a build step. No CSS
framework keeps the bundle small and the markup readable. lucide is
tree-shakeable, so only the icons in use are bundled.

**Follow-up.** Co-locating styles with components (CSS Modules) is a
reasonable next step once the component set grows.

## D15 — Testing strategy and fakes

**Decision.** Vitest everywhere. Tests live in each package's `test/`
directory:
- domain logic is tested without I/O,
- the API is tested with an in-memory store and a fake Spotify,
- the DynamoDB store and the Lambda adapter are tested against
  [dynalite](https://github.com/architect/dynalite), an in-process DynamoDB,
- the CDK stack is tested with template assertions.

The offline demo (`pnpm dev:demo`) reuses the test fakes; it is wired up
only in `backend/dev/server.ts` and `frontend/dev/`, so the app itself has no
demo mode.

**Why.** Fast, deterministic tests without AWS credentials, Docker or a
Spotify account, and a way to try the UI with realistic data.
