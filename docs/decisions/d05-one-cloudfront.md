# D5 — One CloudFront distribution for site and API

**Decision.** CloudFront serves the SPA from a private S3 bucket and routes
`/api/*` to API Gateway. A CloudFront Function rewrites client-side routes to
`index.html`; another forwards the viewer host as `x-public-host`.

**Why.** Same origin: cookies are first-party and there is no CORS at all.
One certificate, one domain, HTTPS everywhere.
