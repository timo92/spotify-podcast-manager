# D25 — Formatting with oxfmt

**Decision.**
- Code, JSON and CSS are formatted by oxfmt, the formatter of the oxc
  project, with the style the code already had: 2 spaces, single quotes,
  semicolons, trailing commas, 120 columns (`.oxfmtrc.json`).
- `pnpm format` formats, `pnpm format:check` runs in CI on both platforms.
- Markdown is left alone: it is hand-wrapped prose, and the formatter's
  Markdown output (emphasis style, table padding, lines inside inline code)
  changes more than it improves.
- `.gitattributes` makes every checkout use LF, so Windows (`core.autocrlf`)
  and CI agree with the formatter.

**Why.** Without a formatter, style was "match the surrounding code" and had
to be checked by eye in reviews. oxfmt is Prettier-compatible in its output
but much faster, and it fits the oxc linter used next to it.

**Alternatives.**
- *Prettier:* the reference, but slower; the output would be nearly the same.
- *Biome:* fast and formatter plus linter in one, but its linter lacks the
  type-aware rules the project wants (see the linter decision).
- *dprint:* fast and pluggable, but a less common setup for a TypeScript and
  React project.
