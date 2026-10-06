# D10 — Sync in a separate Lambda, triggered asynchronously

**Decision.** The API invokes a sync Lambda asynchronously; EventBridge runs
it every 2 hours (incremental) and nightly (full). Only one sync runs at a
time, enforced by a lease in DynamoDB:
- A sync starts only if a conditional write can set the sync state to
  `running` with its `leaseId`, i.e. no other unexpired lease is running.
- The API acquires the lease when the user starts a sync, so the UI shows it
  at once and a second click is ignored. It passes the lease to the Lambda,
  which takes it over under a new lease id. Async invocations are delivered
  at least once, so a duplicate delivery then finds the old id gone and skips.
- Only the lease holder may write the final state. A lease expires after
  16 minutes (the Lambda timeout is 15), so a crashed sync doesn't block
  forever.

**Why.** A first import can take minutes, but API Gateway times out after
29 seconds. Incremental syncs stop paging at the first known episode, which
keeps Spotify API usage low.

**Alternatives.** *Reserved concurrency 1 on the sync Lambda* (the original
approach): no code, but AWS requires 10 concurrent executions to stay
unreserved, and new accounts may only have 10 in total, so the deploy fails
there. The quota can only be raised to 1,000, which is far more than needed.
