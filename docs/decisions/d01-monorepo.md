# D1 — Monorepo with four packages

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
