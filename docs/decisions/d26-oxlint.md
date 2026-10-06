# D26 — Linting with oxlint, including type-aware rules

**Decision.**
- oxlint lints all packages (`.oxlintrc.json`) with the `typescript`,
  `unicorn`, `oxc`, `react` (including the hooks rules), `jsx-a11y`, `import`
  and `vitest` plugins: their correctness rules as errors, the suspicious ones
  as warnings.
- Type-aware rules run through `oxlint-tsgolint` (`--type-aware`), which uses
  the Go port of the TypeScript compiler: `no-floating-promises`,
  `no-misused-promises`, `await-thenable`, `no-unnecessary-type-assertion`
  and the type-aware suspicious rules.
- `pnpm lint` fails on warnings too, and runs in CI on both platforms.
- Rules that don't fit are switched off in the config with the reason next to
  them (e.g. the React Compiler rules, style-only rules). Where the code is
  right in a single place, the line gets `oxlint-disable-next-line <rule> --
  <reason>`.

**Why.** The frontend has many async event handlers and voided promises, and
React hook dependencies were kept right by hand; the type-aware promise rules
and the hooks rules check exactly that. oxlint runs the whole repository,
type-aware rules included, in a few seconds.

**Alternatives.**
- *ESLint with typescript-eslint:* the reference rule set, but type-aware
  linting with it is slow.
- *Biome:* fast, formatter and linter in one, but without type-aware rules.
- *No linter, TypeScript only:* misses floating promises, hook dependencies
  and accessibility problems.
