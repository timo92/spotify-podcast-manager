# D18 — The weekly plan is a list of rules

**Decision.**
- A schedule is a list of rules, `ScheduleRule { id, showId, weekdays, part }`
  ("Wissensreise on Mon, Wed, Fri in the evening"). Each weekday of a rule
  is one slot in the week. A podcast can have several rules, e.g. weekdays in
  the morning and weekends in the evening.
- *Woche* still shows the plan per day. Editing a slot edits its rule, so a
  change applies to every weekday of the rule. Removing a slot offers "only
  this day" (removes the weekday from the rule) or "the whole rule".
- There is no conversion of schedules stored in the earlier shape (one entry
  per weekday). Before V1 there is no data worth keeping; existing
  deployments clear their table.

**Why.** "Weekdays in the morning" is one decision for the user, but with
single slots it was five entries. Changing it meant deleting and re-adding
slots one by one. A rule can be edited as one unit, on *Woche* and on the
podcast's detail page.

**Alternatives.**
- *Keep single slots and group them only in the UI:* the grouping would have
  to be guessed back from the slots on every edit, and two edits of "the same"
  group could drift apart.
- *Convert old schedules when they are read:* keeps old data working, but
  is code to maintain for data that doesn't need to survive before V1.
- *Merge rules automatically (same podcast and part of day):* surprising
  when the user deliberately kept two rules apart.
