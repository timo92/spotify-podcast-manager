# D22 — Plan saves are conditional; the client re-applies its edit once

**Decision.**
- `PUT /api/schedule` takes `expectedUpdatedAt`, the `updatedAt` of the plan
  the edit was made on (`null` if no plan was stored yet). The store writes
  the plan only if that is still the stored version; otherwise the API
  answers 409 `schedule_conflict`. Without `expectedUpdatedAt` the plan is
  overwritten unconditionally.
- The frontend saves an edit as a function of the plan ("remove rule r1",
  "replace rule r2", "add this rule"), not as a finished list. On a conflict
  it loads the current plan, applies the same edit to it and saves once
  more. A second conflict is shown as an error. An edit of a rule that was
  removed elsewhere in the meantime changes nothing.

**Why.** The plan is saved as a whole list. Two open tabs or devices would
otherwise silently undo each other's changes: the second save writes back a
list that lacks the first one's edit. Re-applying the edit keeps both
changes in the common case (different rules) without asking the user.

**Alternatives.**
- *Per-rule endpoints (add, update, delete one rule):* no lost updates
  between rules, but several routes and store operations for a single-user
  app, and edits of the same rule still race.
- *Report every conflict and let the user retry:* simpler, but the user
  would have to repeat an edit that could have been applied as is.
- *An `If-Match` header with an ETag:* the HTTP way, but the version is
  already part of the plan, and a body field needs no header handling in
  the request helper.
