# D8 — DynamoDB single table, on-demand

**Decision.** One table (`PK`/`SK`, one GSI for history and notes), on-demand
billing. Episode metadata (written by the sync) and personal progress
(written by the user) are separate items; every show item carries a
denormalised summary that is recomputed after each change.

**Why.** Pay-per-request costs cents for one user and needs no capacity
planning, patching or VPC (unlike RDS/Aurora). Separate items make it
impossible for a sync to overwrite personal progress. The summaries let
"Heute" and the overview read a single partition instead of every episode.
