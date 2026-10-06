# D4 — REST API on API Gateway HTTP API + one Lambda, written with Hono

**Decision.** A small REST/JSON API served by a single Lambda function
("Lambdalith") behind an API Gateway HTTP API. Routing, cookies and the
Lambda adapter come from [Hono](https://hono.dev); request/response are the
web-standard `Request`/`Response`.

**Why.**
- About 30 endpoints with fixed shapes – REST is the simplest fit.
- One function means one cold start, one log group and one bundle; there is
  no scale or team boundary that would justify a function per route.
- HTTP API is cheaper and simpler than REST API (v1); the features REST API
  adds (API keys, usage plans, request validation) are not needed.
- Hono runs the same app on Lambda (`@hono/aws-lambda`) and locally on Node
  (`@hono/node-server`) and in tests (`app.request()`), so there is no custom
  HTTP abstraction to maintain.

**Alternatives.**
- *AppSync (GraphQL), e.g. via Amplify:* adds a schema, resolvers and an auth
  model built around Cognito/IAM/API keys. Our login is Spotify OAuth with an
  app-owned session, which AppSync would only support through a Lambda
  authorizer – more pieces for no gain. GraphQL's flexibility pays off with
  many clients or deeply nested data; here there is one client and a handful
  of views. Amplify would also take over hosting and infrastructure that CDK
  already describes explicitly.
- *Lambda Function URL instead of API Gateway:* viable and slightly cheaper,
  but API Gateway gives throttling for free.
- *Express/Fastify with an adapter:* heavier and built around Node's
  `http` types rather than web standards.
