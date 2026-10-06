# Architecture decisions

Short records of the choices behind this project: what was decided, why, and
what was considered instead. One file per decision, numbered in the order
they were made.

Context that shapes almost every decision: **one user**, personal use,
deployed into the owner's own AWS account, low traffic, low budget, and the
wish to keep operations close to zero.

## Writing one

- **When:** a choice with real alternatives and lasting consequences
  (architecture, data model, a dependency, a rule the code has to follow).
  Details that only matter to one piece of code (timeouts, margins, labels)
  go into its comments and tests instead.
- **How:** a new file `dNN-<short-slug>.md` with the next free number, a
  `# DNN — Title` heading and the parts **Decision**, **Why** and
  **Alternatives**. Add it to the table below.
- **Changing a decision:** don't rewrite an old entry. Write a new one and
  mark the old one as superseded (in the entry and in the table).

## Index

| ID | Decision |
| --- | --- |
| [D1](d01-monorepo.md) | Monorepo with four packages |
| [D2](d02-pnpm.md) | pnpm as package manager |
| [D3](d03-react-vite.md) | React single-page app built with Vite |
| [D4](d04-hono-api-lambda.md) | REST API on API Gateway HTTP API + one Lambda, written with Hono |
| [D5](d05-one-cloudfront.md) | One CloudFront distribution for site and API |
| [D6](d06-spotify-login-sessions.md) | Login with Spotify only; server-side sessions |
| [D7](d07-spotify-credentials.md) | Spotify credentials come from the deployment; the secret from SSM Parameter Store |
| [D8](d08-dynamodb-single-table.md) | DynamoDB single table, on-demand |
| [D9](d09-backups-retain.md) | Point-in-time recovery and `Retain` for the table |
| [D10](d10-sync-lambda.md) | Sync in a separate Lambda, triggered asynchronously |
| [D11](d11-cdk.md) | AWS CDK in TypeScript |
| [D12](d12-playback-through-spotify.md) | Playback through Spotify, not our own player |
| [D13](d13-spotify-listening-state.md) | Spotify listening state counts by default |
| [D14](d14-plain-css-tokens.md) | Plain CSS with design tokens, lucide icons *(where styles live: superseded by D20)* |
| [D15](d15-testing-and-fakes.md) | Testing strategy and fakes |
| [D16](d16-spotify-compliance.md) | Compliance with Spotify's Developer Terms and Design Guidelines |
| [D17](d17-naming-and-tagging.md) | Naming and tagging: app and stage |
| [D18](d18-weekly-plan-rules.md) | The weekly plan is a list of rules |
| [D19](d19-component-tests.md) | Frontend component tests with Testing Library and jsdom |
| [D20](d20-css-modules.md) | Component styles as CSS Modules |
| [D21](d21-i18n-error-codes.md) | Translations with i18next; the API returns error codes |
| [D22](d22-conditional-plan-saves.md) | Plan saves are conditional; the client re-applies its edit once |
| [D23](d23-individual-notes.md) | Notes are individual entries with a position |
| [D24](d24-playback-read-back.md) | Playback outside the browser is read back on demand |
| [D25](d25-oxfmt.md) | Formatting with oxfmt |
| [D26](d26-oxlint.md) | Linting with oxlint, including type-aware rules |
| [D27](d27-cloudfront-only-api-csp.md) | The API answers only CloudFront; the site sends a CSP |
