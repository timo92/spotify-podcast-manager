# D14 — Plain CSS with design tokens, lucide icons

**Decision.** Plain CSS split by area under `frontend/src/styles/`, colours as
custom properties defined once with `light-dark()`; icons from `lucide-react`.

**Why.** Modern CSS (custom properties, nesting, `light-dark()`, `:has()`)
covers what SASS used to be needed for, without a build step. No CSS
framework keeps the bundle small and the markup readable. lucide is
tree-shakeable, so only the icons in use are bundled.

*Where the styles live is superseded by D20 (CSS Modules); tokens, plain CSS
and lucide still apply.*
