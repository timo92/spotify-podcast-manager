# D9 — Point-in-time recovery and `Retain` for the table

**Decision.** PITR is enabled; the table has `RemovalPolicy.RETAIN`.

**Why.** Listening progress, the weekly plan and notes cannot be recreated
from Spotify – metadata can, personal history cannot. PITR restores the table
to any second of the last 35 days after a bug, a bad deploy or an accidental
"delete all data". It costs roughly $0.20 per GB-month, and this table is a
few megabytes. `Retain` keeps the data even if the stack is destroyed.

**Alternatives.** On-demand backups (manual, easy to forget); no backups
(cheapest, but one bug away from losing everything).
