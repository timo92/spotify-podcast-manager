# D17 — Naming and tagging: app and stage

**Decision.**
- A deployment is identified by a name prefix (`STACK_NAME`, default
  `PodcastCockpit`) and a stage (`STAGE`, default `dev`).
- **Stacks** are named `<prefix>-<stage>` and `<prefix>-<stage>-Certificate`.
- **SSM parameters** use the stage as a path segment:
  `/<prefix>/<stage>/spotify-client-secret`.
- **Other resources** keep CDK's generated names, which start with the
  stack name.
- **Tags:** every resource of both stacks is tagged `app=podcast-cockpit`,
  `stage=<stage>` and `managed-by=cdk`, applied once to the whole CDK app.

**Why.**
- Several stages can live in the same account without clashing: each gets
  its own stacks, table, parameter and (via `DOMAIN_NAME`) domain.
- Path segments allow IAM policies and listings per app or per stage
  (`/PodcastCockpit/dev/*`).
- The tags make resources findable in the console and, once activated as
  cost allocation tags, split the bill by app and stage. `managed-by=cdk`
  warns against changing those resources by hand.

**Alternatives.**
- *Explicit physical names for all resources:* more readable, but they block
  CloudFormation replacements and clash between stages.
- *One AWS account per stage:* stronger isolation and the usual
  recommendation for production. It stays possible with the same
  configuration.
