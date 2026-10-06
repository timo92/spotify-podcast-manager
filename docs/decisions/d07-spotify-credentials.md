# D7 — Spotify credentials come from the deployment; the secret from SSM Parameter Store

**Decision.**
- The client ID is a plain environment variable (`SPOTIFY_CLIENT_ID`), set
  from `.env` locally or from CI variables, and passed to the Lambdas by CDK.
  Synth fails without it.
- The client secret lives in an SSM Parameter Store *SecureString* that the
  stack creates, named `/<app>/<stage>/spotify-client-secret`, with a placeholder value (via a small
  custom resource). Setting the real value is a documented post-deploy step
  (`pnpm run secret:put`, which finds the name in the stack outputs, or the
  console). The Lambdas read it at runtime and cache it for five minutes.
  While the placeholder is in place, the app reports itself as not configured.
- `.env` is loaded by Node itself (`--env-file-if-exists` in every script and
  in the `cdk` app command), not by code or a dotenv dependency.
- Spotify access/refresh tokens are stored in DynamoDB and never reach the
  browser, except a short-lived access token for the Web Playback SDK.

**Why.**
- Configuration belongs to the deployment, not to the app's data. It is
  reproducible, works the same in CI, and leaves no setup page or setup code
  to protect.
- The secret must not be a plain Lambda environment variable, because that
  would write it into the CloudFormation template and the Lambda console.
- Letting the stack own the parameter means its name is derived, not
  configured, and the parameter is removed together with the stack. Standard
  SecureString parameters are free and encrypted with the AWS-managed KMS key.

**Alternatives.**
- *Secrets Manager:* $0.40 per secret per month. Its main extra, managed
  rotation, doesn't apply, because a Spotify secret can only be rotated by
  hand in the Spotify dashboard.
- *A configurable parameter name, created before the first deploy:* one more
  setting, and a pre-deploy check to keep it in sync with the stack.
- *A CloudFormation-managed parameter:* SecureString is not supported, and
  the value would end up in the template anyway.
- *Entering the credentials in the UI* (the earlier approach): needed a setup
  page and a setup code, and stored the secret in the app's own table.
- *PKCE without a client secret:* Spotify then issues single-use refresh
  tokens. The API and sync Lambdas would need a lock so they never refresh at
  the same moment.
