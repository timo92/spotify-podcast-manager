# D20 — Component styles as CSS Modules

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
