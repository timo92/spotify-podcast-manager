# D3 — React single-page app built with Vite

**Decision.** React 19 + TypeScript, Vite, React Router, TanStack Query for
server state. No SSR.

**Why.**
- The app sits behind a login and needs no SEO, so server rendering adds cost
  and moving parts without benefit. A static build on S3/CloudFront is the
  cheapest and simplest hosting there is.
- The Spotify Web Playback SDK runs in the browser anyway.
- React has the largest ecosystem and is familiar; TanStack Query covers
  caching, refetching and invalidation, so no global state library is needed.

**Alternatives.** Next.js (needs a server runtime or Amplify Hosting; SSR not
needed); Vue/Svelte (equally viable; React chosen for ecosystem and
familiarity).
