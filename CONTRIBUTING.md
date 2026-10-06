# Contributing

How code, commits and pull requests are written in this repo. The reasons
behind the architecture are in [docs/decisions/](docs/decisions/README.md); what
the app does is in [docs/requirements.md](docs/requirements.md).

## Commands

Node.js 22+ and pnpm (`corepack enable` picks the version from
`package.json`).

```bash
pnpm install
pnpm dev:demo        # local app with fake Spotify, no credentials needed
pnpm dev             # local app against real Spotify (needs .env)
pnpm format          # format code, JSON and CSS (oxfmt)
pnpm lint            # oxlint, including type-aware rules
pnpm typecheck
pnpm test
pnpm test:coverage   # tests with coverage; HTML report in packages/*/coverage/
pnpm build
```

CI runs these on Ubuntu **and** Windows for every PR; a PR is mergeable only
when both pass:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cd packages/infra && SPOTIFY_CLIENT_ID=ci-synth-placeholder pnpm exec cdk synth -q
```

On Ubuntu, CI runs the tests with coverage instead and shows it per package in
the job summary; the HTML report is attached to the run. There is no minimum
yet. Run them before you push. Keep package scripts cross-platform: no POSIX-only
syntax (`VAR=x cmd`, `rm -rf`, `&&` chains that assume bash); use Node flags or
CLI arguments instead.

To try a branch without checking it out, open it in GitHub Codespaces; the dev
container starts `pnpm dev:demo` (see "Preview a branch in Codespaces" in the
README).

## Code

### Where code goes

- **`packages/shared`**: domain types and pure logic (next-episode selection,
  budget, weekly plan, retention dates). No I/O. Anything both the frontend and
  backend need, or any rule worth unit-testing on its own, belongs here.
- **`packages/backend`**: the Hono API (`src/app.ts`), the Lambda handlers,
  services, the Spotify client and the stores. `dev/` holds the local server,
  `test/` the tests and fakes.
- **`packages/frontend`**: the React SPA. Pages in `src/pages`, components in
  `src/components`, API calls and queries in `src/lib`. A component's
  styles sit next to it as `<Component>.module.css`; `src/styles` holds the
  global ones (D20). `dev/` holds development-only helpers; the app itself has no
  demo mode.
- **`packages/infra`**: the CDK app. Names, stage and tags come from
  `lib/config.ts`.

### Style

Formatting is done by oxfmt (`pnpm format`, configured in `.oxfmtrc.json`,
D25); CI rejects unformatted code. Markdown is not formatted automatically.
A commit that only reformats goes into `.git-blame-ignore-revs`.
oxlint (`pnpm lint`, `.oxlintrc.json`, D26) checks correctness, promises, React
hooks and accessibility; warnings fail CI too. Where the code is right but a
rule disagrees, disable it for that line with the reason:
`// oxlint-disable-next-line <rule> -- <reason>`. Beyond what the tools cover:

- TypeScript in strict mode everywhere. No `any`. Prefer narrowing and type
  guards over `as` casts and `!` in production code.
- `camelCase` for values and functions, `PascalCase` for types and React
  components, `UPPER_SNAKE_CASE` for module-level constants.
- File names: `kebab-case.ts`; React components `PascalCase.tsx`.
- ESM throughout: relative imports in `backend` and `infra` end in `.js`.
  Type-only imports use `type` (`import { buildWeek, type Schedule } from
  '@podcast/shared'`).
- Small, named functions over long ones; no dead code, no commented-out code.

### Comments

- Explain **why** and the **contract**, not what the next line does. Exported
  interfaces, store methods and non-obvious functions get a JSDoc comment.
- Describe the code as it is now. No history ("previously…", "after the
  refactoring…", "the next PR will…"); that belongs in commits and PRs.
- No issue numbers in comments, except a forward reference in a TODO:
  `// TODO(#12): …`.

### Language

- User-facing text is German and English. It lives only in
  `frontend/src/locales/<de|en>/<area>.json` and is used through
  `useTranslation` (typed keys); no UI string is hard-coded in a component.
  Add every key to both languages; the i18n test checks that.
- API errors carry a stable `code` (and `params`) that the frontend
  translates; their `message` is a German fallback for logs. Codes and their
  parameters are declared in `shared/src/errors.ts` (`ErrorParams` and
  `ERROR_PARAMS`); the type check then requires them at every `throw` and a
  text for each in both `errors.json` files.
- Everything else is English: identifiers, comments, docs, commits, PRs,
  issues.

### Backend

- Routes live in `src/app.ts`. Business logic goes into services
  (`src/services`), not into route handlers.
- Errors are `ApiError`s created with the helpers in `src/errors.ts`
  (`badRequest`, `notFound`, …), each with a stable `code`. Status codes come
  from `http-status-codes`.
- Persistence goes only through the `Store` interface (`src/store/types.ts`).
  Every store method is implemented in `MemoryStore` and `DynamoStore` and
  covered by the store contract tests, which run against both.
- Writes that can race (the sync, logins, token refreshes, plan saves) use
  conditional writes; see the sync lease in D10.
- The sync writes only Spotify metadata. Personal state (progress, settings,
  plan, notes) is never overwritten by it.
- No secrets in code, logs or templates. Credentials come from the deployment
  (D7).

### Frontend

- Server state through TanStack Query (`src/lib/queries.ts`), HTTP calls
  through `src/lib/api.ts`.
- Icons from `lucide-react` via `src/components/Icon.tsx`.
- Plain CSS with the design tokens in `src/styles/tokens.css`; no inline colours
  or magic numbers.
- Component styles go into `<Component>.module.css` next to the component
  (camelCase class names, joined with `cx`). Only tokens, base styles and
  shared primitives (buttons, chips, badges, cards, sheets, …) are global.
  Refer to a global class from a module with `:global(.name)` and to shared
  keyframes with `global(name)`.
- Keep the Spotify compliance from D16 intact: attribution and official logos,
  artwork never cropped, "Open in Spotify" links.
- Mobile first: every page must work at phone width.

### Infrastructure

- Every resource gets its name from the stage-aware config and the tags
  `app`, `stage` and `managed-by` (D17).
- Data-holding resources keep `RemovalPolicy.RETAIN` (D9).
- Infra changes get a CDK assertion test.

### Tests

- Vitest; tests live in each package's `test/` folder.
- Every behaviour change comes with a test: pure logic in `shared`, API
  behaviour through the backend app tests (with `MemoryStore` and the fake
  Spotify), store changes in the store contract tests, UI behaviour through
  frontend component tests, infra through CDK assertions.
- Frontend component tests live in `frontend/test/components` and
  `frontend/test/pages`. They render with `renderWithProviders`
  (`test/support/render.tsx`) and mock the API per test with
  `vi.spyOn(api, …)`; an unmocked request fails the test. Query elements by
  role and visible text, as a user would find them.
- A bug fix starts with a test that fails without the fix.

### Docs

- A new or changed architectural decision gets its own file in
  `docs/decisions/` (next free number; **Decision**, **Why**,
  **Alternatives**) and a line in its index. Only choices with real
  alternatives and lasting consequences get one; details of a single piece of
  code belong in its comments and tests. Don't rewrite an old entry; mark it
  superseded.
- Behaviour changes update `docs/requirements.md` and, where relevant, the
  README. A requirement says what the user can do, in a sentence or two;
  how exactly a screen looks or behaves is pinned down by the tests. New
  requirements get the next free ID of their section; IDs are never reused.

## Commits

- **One logical change per commit.** Tests and docs go into the same commit as
  the code they belong to.
- **Subject:** imperative, capitalised, no trailing period, at most 72
  characters, no type prefix (`feat:`, `fix:`). It describes the effect:
  "Show the chosen episode in every slot of a manual podcast", not "Update
  plan.ts".
- **Body** (optional for trivial changes): what changed and why, wrapped at
  72 characters. Use a bullet list when a commit has several aspects, and
  mention updated docs.
- Reference issues in the body ("Part of #7"); the PR closes the issue.
- **Never amend, rebase or force-push a branch that has been pushed.** Every
  fix-up, also after a review, is a new commit, so a reviewer can follow the
  changes commit by commit.
- To bring a branch up to date, merge `main` (or the branch below it in a
  stack) into it.

## Branches and pull requests

- One issue, one branch, one PR. Branch name: `issue-<n>-<short-slug>`
  (Claude Code cloud sessions prefix it with `claude/`).
- Nothing is pushed to `main` directly; every change goes through a PR with
  green CI.
- **PR title:** follows the commit subject rules. PRs are **squash-merged**,
  so the title and description become the commit on `main`.
- **PR description:**
  - `Closes #<n>`
  - a short summary of the change;
  - **How to test manually:** steps in the running app;
  - **Decisions to confirm:** choices the issue left open, if any;
  - **Follow-ups:** issues created along the way, if any.
- **Stacked PRs:** when an issue builds on an unmerged one, base its branch and
  PR on that branch. After the lower PR is squash-merged, GitHub retargets the
  next PR to `main`; then merge `main` into its branch, keeping the branch's
  side where the content is already contained.
- **Out-of-scope findings** (bugs, gaps, improvements) become new issues in the
  fitting milestone, in the style of the existing ones: problem, cause if
  known, suggested fix, "Done when". They are not fixed in the current PR.
