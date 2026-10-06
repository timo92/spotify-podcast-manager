# D15 — Testing strategy and fakes

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
