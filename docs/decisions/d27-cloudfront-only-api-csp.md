# D27 — The API answers only CloudFront; the site sends a CSP

**Decision.**
- CloudFront adds an `x-origin-verify` header to every API request. The API
  Lambda refuses requests without it with 403 `origin_forbidden`, so the
  public `execute-api` endpoint can't be called directly.
- The header's value is the UUID of the stack (from its stack ID). The stack
  passes it to the API Lambda as `ORIGIN_SECRET`. Locally the variable is
  unset and the check is off.
- A custom response headers policy replaces AWS's managed
  `SECURITY_HEADERS`. It keeps the managed headers and adds a
  Content-Security-Policy and a Permissions-Policy (both in
  `infra/lib/podcast-stack.ts`).
- The CSP is sent as `Content-Security-Policy-Report-Only` until a deployment
  has played an episode with the real Web Playback SDK without violations.
  Enforcing it then means moving it into the policy's security headers.
- *Update:* a deployment played an episode without violations, so the CSP
  is now enforced (`Content-Security-Policy`, #98).

**Why.**
- Called directly, the API skips CloudFront's headers and would trust a
  client-supplied `x-public-host` for the OAuth redirect URI and the cookie's
  `Secure` flag. Spotify rejects unregistered redirect URIs, so this is
  defence in depth.
- CloudFront can't read an SSM SecureString into an origin header. The stack
  UUID is random, never leaves the account, and needs no extra resource or
  setup step.
- A CSP limits what an injected script could load or send. The SDK is the
  only third-party script, and only a real deployment shows whether it needs
  more than the policy allows.

**Alternatives.**
- *A random value from a custom resource, or an SSM parameter:* one more
  resource for the same protection. Rotation would still need a deployment.
- *A Lambda function URL behind CloudFront Origin Access Control (IAM
  auth):* the AWS-native way, but it replaces API Gateway and its
  throttling.
- *AWS WAF on the API:* costs per month, too much for one user.
- *Enforcing the CSP right away:* a missing source would break playback
  without a way to check it beforehand.
