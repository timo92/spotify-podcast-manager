# CLAUDE.md

Podcast-Cockpit: a personal, non-commercial web app in front of Spotify. See
[README.md](README.md) for what it does, [docs/decisions.md](docs/decisions.md)
for why it is built this way (read the relevant entries before changing the
architecture) and [docs/requirements.md](docs/requirements.md) for the
expected behaviour.

The code, commit and PR guidelines apply to you as well:

@CONTRIBUTING.md

## Rules for Claude Code sessions

### Git

- Never push to `main`, never force-push, never amend or rebase. Every change,
  including fixes after a review, is a new commit on top.
- **Local session:** commit when a change is done, then say that it is ready
  locally and wait. Push only when the user asks for it in that moment; an
  earlier approval doesn't cover later commits.
- **Cloud session:** push only your own `claude/…` branches.
- Squash or rebase only when the user asks for it, and only over unpushed
  commits.
- "Update the stack" means: merge the lower branch (or `origin/main`) into
  each branch above it, bottom-up, with a merge commit, then push.

### Decisions

- Don't decide what the issue or the user left open. In a local session, ask
  and present options with a recommendation. In a cloud session, pick the
  least invasive option that fulfils the issue, implement it, and list it under
  "Decisions to confirm" in the PR.
- "Create an issue" means file it only, not implement it.
- When the user points out a mistake, acknowledge it and ask before changing
  state (especially git) to "fix" it.

### Secrets

- `.env` holds credentials and personal settings. Never read, print or commit
  its values; `.env.example` documents the variables.
- `packages/backend/.local-data/` is the local store of `pnpm dev`, including
  the Spotify tokens. Don't read it either.
- `.claude/settings.json` denies file access to both. The rule above also
  covers shell commands, which those settings don't reliably catch.
- Never deploy, and never run AWS commands that change resources, unless the
  user asks for it.

### What you cannot verify

- Deploying and logging in with Spotify need the user's AWS profile and
  Spotify account. Verify UI changes with `pnpm dev:demo` (fake Spotify), and
  state in the PR what you could not verify.

### Windows

The user develops on Windows; CI runs on Windows too.

- In Git Bash, `tsc` can resolve to a different binary; use `pnpm typecheck`
  (or `node node_modules/typescript/bin/tsc`).
- "Parameterformat falsch - 65001" at the start of pnpm output comes from the
  shell shim on a German Windows and is harmless.
- Files are checked out with CRLF line endings (`core.autocrlf`).
