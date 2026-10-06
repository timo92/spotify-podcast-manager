# D2 — pnpm as package manager

**Decision.** pnpm workspaces (`pnpm-workspace.yaml`, `workspace:*`
dependencies). Install scripts are blocked by default and allowed only for
`esbuild` and `classic-level`.

**Why.** Strict dependency resolution (a package can only import what it
declares), fast installs through a content-addressed store, and an explicit
allow-list for install scripts as a supply-chain safeguard.
