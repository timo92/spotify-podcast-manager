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
- The first account that logs in becomes the owner. Nobody else can win that
  race: in Spotify's development mode, only accounts listed under *User
  Management* of the Spotify app can log in at all.
- An earlier version protected a browser setup page with a one-time setup
  code; it became unnecessary once the credentials moved into the deployment
  (D7).

**Why.** The user needs a Spotify login anyway. A second identity system
(Cognito) would mean a second password for a single person. Server-side
sessions can be revoked (logout, "delete all data"), unlike stateless tokens.

## D7 — Spotify credentials come from the deployment; the secret from SSM Parameter Store

**Decision.**
- The client ID is a plain environment variable (`SPOTIFY_CLIENT_ID`), set
  from `.env` locally or from CI variables, and passed to the Lambdas by CDK.
  Synth fails without it.
- The client secret lives in an SSM Parameter Store *SecureString* that the
  stack creates, named `/<app>/<stage>/spotify-client-secret`, with a placeholder value (via a small
  custom resource). Setting the real value is a documented post-deploy step
  (`pnpm run secret:put`, which finds the name in the stack outputs, or the
  console). The Lambdas read it at runtime and cache it for five minutes.
  While the placeholder is in place, the app reports itself as not configured.
- `.env` is loaded by Node itself (`--env-file-if-exists` in every script and
  in the `cdk` app command), not by code or a dotenv dependency.
- Spotify access/refresh tokens are stored in DynamoDB and never reach the
  browser, except a short-lived access token for the Web Playback SDK.

**Why.**
- Configuration belongs to the deployment, not to the app's data. It is
  reproducible, works the same in CI, and leaves no setup page or setup code
  to protect.
- The secret must not be a plain Lambda environment variable, because that
  would write it into the CloudFormation template and the Lambda console.
- Letting the stack own the parameter means its name is derived, not
  configured, and the parameter is removed together with the stack. Standard
  SecureString parameters are free and encrypted with the AWS-managed KMS key.

**Alternatives.**
- *Secrets Manager:* $0.40 per secret per month. Its main extra, managed
  rotation, doesn't apply, because a Spotify secret can only be rotated by
  hand in the Spotify dashboard.
- *A configurable parameter name, created before the first deploy:* one more
  setting, and a pre-deploy check to keep it in sync with the stack.
- *A CloudFormation-managed parameter:* SecureString is not supported, and
  the value would end up in the template anyway.
- *Entering the credentials in the UI* (the earlier approach): needed a setup
  page and a setup code, and stored the secret in the app's own table.
- *PKCE without a client secret:* Spotify then issues single-use refresh
  tokens. The API and sync Lambdas would need a lock so they never refresh at
  the same moment.

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
it every 2 hours (incremental) and nightly (full). Only one sync runs at a
time, enforced by a lease in DynamoDB:
- A sync starts only if a conditional write can set the sync state to
  `running` with its `leaseId`, i.e. no other unexpired lease is running.
- The API acquires the lease when the user starts a sync, so the UI shows it
  at once and a second click is ignored. It passes the lease to the Lambda,
  which takes it over under a new lease id. Async invocations are delivered
  at least once, so a duplicate delivery then finds the old id gone and skips.
- Only the lease holder may write the final state. A lease expires after
  16 minutes (the Lambda timeout is 15), so a crashed sync doesn't block
  forever.

**Why.** A first import can take minutes, but API Gateway times out after
29 seconds. Incremental syncs stop paging at the first known episode, which
keeps Spotify API usage low.

**Alternatives.** *Reserved concurrency 1 on the sync Lambda* (the original
approach): no code, but AWS requires 10 concurrent executions to stay
unreserved, and new accounts may only have 10 in total, so the deploy fails
there. The quota can only be raised to 1,000, which is far more than needed.

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

*Where the styles live is superseded by D20 (CSS Modules); tokens, plain CSS
and lucide still apply.*

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

## D16 — Compliance with Spotify's Developer Terms and Design Guidelines

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

## D17 — Naming and tagging: app and stage

**Decision.**
- A deployment is identified by a name prefix (`STACK_NAME`, default
  `PodcastCockpit`) and a stage (`STAGE`, default `dev`).
- **Stacks** are named `<prefix>-<stage>` and `<prefix>-<stage>-Certificate`.
- **SSM parameters** use the stage as a path segment:
  `/<prefix>/<stage>/spotify-client-secret`.
- **Other resources** keep CDK's generated names, which start with the
  stack name.
- **Tags:** every resource of both stacks is tagged `app=podcast-cockpit`,
  `stage=<stage>` and `managed-by=cdk`, applied once to the whole CDK app.

**Why.**
- Several stages can live in the same account without clashing: each gets
  its own stacks, table, parameter and (via `DOMAIN_NAME`) domain.
- Path segments allow IAM policies and listings per app or per stage
  (`/PodcastCockpit/dev/*`).
- The tags make resources findable in the console and, once activated as
  cost allocation tags, split the bill by app and stage. `managed-by=cdk`
  warns against changing those resources by hand.

**Alternatives.**
- *Explicit physical names for all resources:* more readable, but they block
  CloudFormation replacements and clash between stages.
- *One AWS account per stage:* stronger isolation and the usual
  recommendation for production. It stays possible with the same
  configuration.

## D18 — The weekly plan is a list of rules

**Decision.**
- A schedule is a list of rules, `ScheduleRule { id, showId, weekdays, part }`
  ("Wissensreise on Mon, Wed, Fri in the evening"). Each weekday of a rule
  is one slot in the week. A podcast can have several rules, e.g. weekdays in
  the morning and weekends in the evening.
- *Woche* still shows the plan per day. Editing a slot edits its rule, so a
  change applies to every weekday of the rule. Removing a slot offers "only
  this day" (removes the weekday from the rule) or "the whole rule".
- There is no conversion of schedules stored in the earlier shape (one entry
  per weekday). Before V1 there is no data worth keeping; existing
  deployments clear their table.

**Why.** "Weekdays in the morning" is one decision for the user, but with
single slots it was five entries. Changing it meant deleting and re-adding
slots one by one. A rule can be edited as one unit, on *Woche* and on the
podcast's detail page.

**Alternatives.**
- *Keep single slots and group them only in the UI:* the grouping would have
  to be guessed back from the slots on every edit, and two edits of "the same"
  group could drift apart.
- *Convert old schedules when they are read:* keeps old data working, but
  is code to maintain for data that doesn't need to survive before V1.
- *Merge rules automatically (same podcast and part of day):* surprising
  when the user deliberately kept two rules apart.

## D19 — Frontend component tests with Testing Library and jsdom

**Decision.**
- Components and pages are tested with Vitest, React Testing Library and
  `user-event`, in a jsdom environment (`test` section of
  `frontend/vite.config.ts`).
- `renderWithProviders` renders with the app's providers (query client
  without retries, toasts, player, an in-memory router). Tests mock the
  `api` object per test; any request that isn't mocked fails, so no test
  depends on a backend.
- Tests find elements by role and visible text and assert on what the user
  sees or on the API calls made.
- Browser end-to-end checks against `pnpm dev:demo` stay manual and outside
  CI.

**Why.** UI behaviour (links, editors, confirmations) could only be checked
by hand. Testing Library tests run in the existing `pnpm test`, on Ubuntu and
Windows, in seconds, and keep working when markup or styles change, as long
as the user-visible behaviour stays the same. Mocking `api` rather than
`fetch` keeps tests independent of URLs and response encoding.

**Alternatives.**
- *Playwright component or end-to-end tests in CI:* closer to a real browser,
  but needs browsers on both CI runners and running demo servers, and is
  slower. Worth it later for a few critical flows.
- *happy-dom instead of jsdom:* faster, but less complete; jsdom is the
  default the Testing Library docs assume.
- *Mocking `fetch` or a mock service worker:* tests the HTTP layer too, which
  the backend app tests already cover.

## D20 — Component styles as CSS Modules

**Decision.** Supersedes the file layout of D14.
- A component's or page's own rules live in `<Component>.module.css` next to
  it and are imported as `styles` (`className={styles.item}`). Class names
  in modules are camelCase. Pages that share a layout share one module
  (`pages/auth.module.css`).
- `src/styles/` keeps only what is global: tokens, base and utilities
  (`.row`, `.muted`, …), page layout (`.page`, `.section`, `.container`) and
  the shared primitives (buttons, chips, badges, toggles, cards, covers,
  lists, menus, sheets, search).
- Global styles are imported first in `main.tsx`; modules load after them,
  so a module rule can refine a primitive with the same specificity.
- A module refers to global classes with `:global(.name)` and to shared
  keyframes with `global(name)`. Conditional classes are joined with `cx`.
- Native CSS nesting where it groups a component's states and children.

**Why.** A component's styles sit next to its markup, can't leak into other
components, and disappear with it. Vite supports CSS Modules without a
dependency. Keeping the primitives global avoids passing class names around
for buttons and badges, which appear everywhere.

**Alternatives.**
- *Keep global files per area:* simple, but every class name is global and a
  component's styles live away from it.
- *CSS-in-JS or utility classes (Tailwind):* a runtime or a build-time
  dependency and a different way of writing styles, for no gain at this size.
- *SASS modules:* nesting and variables are native CSS now.

## D21 — Translations with i18next; the API returns error codes

**Decision.**
- The UI is translated with `i18next` and `react-i18next`. Texts live in
  `frontend/src/locales/<de|en>/<namespace>.json`, one namespace per area
  (common, today, plan, shows, episode, history, settings, auth, player,
  errors). Keys are typed from the German files, so a missing or misspelt
  key fails the type check; a test checks that both languages have the same
  keys and variables.
- The language follows the browser (German, else English). Einstellungen can
  pin German or English; the choice is stored in this browser only
  (`localStorage`, like the theme), not in the user's settings. Dates and
  durations use `Intl` with the browser's locale for the active language.
- The API returns a stable error `code` with `params`; the frontend
  translates it, and the German `message` stays as a fallback and for logs.
  The codes and their parameters are declared once in `shared`
  (`ErrorParams`, plus `ERROR_PARAMS` for the parameter names at runtime).
  The backend can only throw declared codes with their parameters, both
  translation files must have a text for every code (`satisfies` on the
  imported JSON), and a test checks that each text uses exactly the code's
  parameters. Codes the login page explains are a `LoginErrorCode`.
  The sync state carries counts, the reloaded podcast and an error code,
  and the frontend builds its own messages from them.
- User data stays as it is: category names, episode titles and the default
  categories created for new installations are not translated.
- Spotify's link labels ("LISTEN ON SPOTIFY", "PLAY ON SPOTIFY") stay in
  English in both languages, as the design guidelines give them (D16).

**Why.** i18next is the most widely used option, supports plurals,
interpolation and inline markup (`<Trans>`), and needs no build step. Error
codes keep the backend independent of the UI language and let a client
explain errors in its own words. A per-browser choice needs no API change
and matches the theme setting.

**Alternatives.**
- *FormatJS (react-intl):* ICU messages are more expressive, but heavier
  for two languages and simple plurals.
- *A hand-written dictionary:* no dependency, but no plurals, interpolation
  or typed keys without writing them ourselves.
- *Error codes only as string literals, checked by scanning the backend
  source:* catches a missing translation, but not a mistyped code or a
  parameter named differently on each side.
- *Translated messages from the backend (Accept-Language):* every error and
  status text would need both languages on the server, and cached responses
  would depend on the header.
- *Storing the language in the user's settings:* follows the user across
  devices, but needs an API change and is less useful than following each
  device's browser.

## D22 — Plan saves are conditional; the client re-applies its edit once

**Decision.**
- `PUT /api/schedule` takes `expectedUpdatedAt`, the `updatedAt` of the plan
  the edit was made on (`null` if no plan was stored yet). The store writes
  the plan only if that is still the stored version; otherwise the API
  answers 409 `schedule_conflict`. Without `expectedUpdatedAt` the plan is
  overwritten unconditionally.
- The frontend saves an edit as a function of the plan ("remove rule r1",
  "replace rule r2", "add this rule"), not as a finished list. On a conflict
  it loads the current plan, applies the same edit to it and saves once
  more. A second conflict is shown as an error. An edit of a rule that was
  removed elsewhere in the meantime changes nothing.

**Why.** The plan is saved as a whole list. Two open tabs or devices would
otherwise silently undo each other's changes: the second save writes back a
list that lacks the first one's edit. Re-applying the edit keeps both
changes in the common case (different rules) without asking the user.

**Alternatives.**
- *Per-rule endpoints (add, update, delete one rule):* no lost updates
  between rules, but several routes and store operations for a single-user
  app, and edits of the same rule still race.
- *Report every conflict and let the user retry:* simpler, but the user
  would have to repeat an edit that could have been applied as is.
- *An `If-Match` header with an ETag:* the HTTP way, but the version is
  already part of the plan, and a body field needs no header handling in
  the request helper.

## D23 — Notes are individual entries with a position

**Decision.**
- An episode has any number of notes. Each note is its own item
  (`NOTE#<showId>` / `<episodeId>#<noteId>`) with a text, a position in the
  episode (`positionMs`, or null for a note on the whole episode) and the
  time it was written. Notes are created, edited and deleted one by one.
- The notes of an episode are listed by position. *Verlauf → Notizen* shows
  one card per note; search matches single notes, and the period filter and
  the order use the time a note was written, not its last edit.
- A new note gets the position of the browser player from when typing
  started, if it plays the episode. Otherwise the server asks Spotify for the
  playback state (`GET /me/player`, covered by `user-read-playback-state`)
  and uses its position if Spotify is playing this episode on any device. If
  Spotify can't be asked, the note is saved without a position.
- There is no conversion of notes stored as one text per episode. Before V1
  there is no data worth keeping; existing deployments delete their `NOTE#`
  items.

**Why.** Notes are most useful for episodes heard over days or weeks. With
one text per episode, a search found the whole text instead of the thought,
a single line added later moved all of an episode's notes into "this week",
and a timestamp could only be inserted while listening in the browser. Single
notes with a position fix all three, and the position works with the Spotify
app on a phone as well.

**Alternatives.**
- *Keep one text and parse `[mm:ss]` lines into entries for display:* no
  model change, but editing, deleting and dating single entries would depend
  on how the text is formatted.
- *A separate "notes" table or one item per episode holding a list:* a list
  item grows without bound and every edit rewrites all notes of the episode;
  separate items fit the existing single-table layout (D8).
- *Take the position only in the browser:* simpler, but no position for the
  most common way of listening, the Spotify app.

## D24 — Playback outside the browser is read back on demand

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
  once more. Auto-complete applies as in the browser player, with a wider
  margin at the end because the position is only known every 30 seconds.

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
