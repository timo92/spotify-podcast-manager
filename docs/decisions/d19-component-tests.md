# D19 — Frontend component tests with Testing Library and jsdom

**Decision.**
- Components and pages are tested with Vitest, React Testing Library and
  `user-event`, in a jsdom environment (`test` section of
  `frontend/vite.config.ts`).
- `renderWithProviders` renders with the app's providers (query client
  without retries, toasts, player, an in-memory router). Tests mock the
  `api` object per test; any request that isn't mocked fails, so no test
  depends on a backend.
- Tests find elements by role and visible text and assert on what the user
  sees or on the API calls made.
- Browser end-to-end checks against `pnpm dev:demo` stay manual and outside
  CI.

**Why.** UI behaviour (links, editors, confirmations) could only be checked
by hand. Testing Library tests run in the existing `pnpm test`, on Ubuntu and
Windows, in seconds, and keep working when markup or styles change, as long
as the user-visible behaviour stays the same. Mocking `api` rather than
`fetch` keeps tests independent of URLs and response encoding.

**Alternatives.**
- *Playwright component or end-to-end tests in CI:* closer to a real browser,
  but needs browsers on both CI runners and running demo servers, and is
  slower. Worth it later for a few critical flows.
- *happy-dom instead of jsdom:* faster, but less complete; jsdom is the
  default the Testing Library docs assume.
- *Mocking `fetch` or a mock service worker:* tests the HTTP layer too, which
  the backend app tests already cover.
