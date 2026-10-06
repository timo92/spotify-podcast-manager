# D21 — Translations with i18next; the API returns error codes

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
