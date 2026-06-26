# TMCP: Smart Reminder Confirmation Service Message

> Source: operator voice msg 75128, 2026-06-15 ~11:00 PT. Directive: scope out the feature, create a task, and pass it to the agent for implementation.

## Two Distinct Features (operator clarified 2026-06-15)

### Feature A — SET confirmation (CORE, operator's original ask)
When any reminder/cron is SET, TMCP emits a service message confirming:
1. What was set (tool response itself stays simple: "ok" / "confirmed" / "set")
2. What the reminder will do in plain language
3. Persistence status: "NOT saved to profile — won't survive session restart"
4. Far-future warning if >~1 day out: "fires 2027-06-15 — likelihood of this session surviving is low. Consider one-shot instead."

### Feature B — FIRE payload enrichment (nice-to-have, operator liked it)
When a recurring reminder actually FIRES, include `next_fire` in the reminder event payload.
Benefit: agent sees "this will fire again 2027-06-15" and can self-correct if the date seems wrong.
This is separate from Feature A and can be shipped independently.

## Tiered Feedback (Recurring Reminders)

Scale the richness of the feedback message to the repetition intensity / potential for surprise:

**Tier 1 — High frequency (every few minutes):**
Simple confirmation. "Reminder set: fires every 5 min. Recurring."

**Tier 2 — Moderate (hourly / daily):**
Confirmation + next-fire absolute timestamp. "Reminder set: fires daily at 09:00 PT. Next: 2026-06-16T09:00-07:00. Recurring."

**Tier 3 — Far-future / low frequency (weekly+, date-pinned, annual):**
Confirmation + warning + actionable suggestion.
Example (annual):
> "Reminder set: fires 2027-06-15. This is a recurring reminder scheduled ~1 year from now. The likelihood of this session surviving to fire is very low. Consider setting it as a one-shot reminder instead, or wiring it to a persistent profile reminder. You can delete it with `reminder/cancel` or replace it."

## Persistence Flag

Always include persistence status:
- One-shot, not in profile → "Not persistent. Will fire once then expire."
- Recurring, not in profile → "Not saved to profile — will not survive a session restart. To persist, save to profile via `profile/save`."
- Saved in profile → "Saved to profile. Will reload on next session start."

## Implementation

- Mechanism: service message (not inline response) — operator's preferred design
- Response body stays simple ("ok" / "set" / {id, next_fire})
- Service message fires synchronously after the set operation
- Smart copy: TMCP generates the explanation from the reminder parameters — no agent action needed

## Routing

Pass to the implementing agent for design + implementation spec. The broader context is in the TMCP backlog file (far-future-reminder-warning-2026-06-15.md).

## Related

- Task #6: TMCP feature — reminder confirmation + impact summary
- operator context: reliability defects — CronCreate durable:true bug is related


---
_Closed 2026-06-26 by task-board audit — shipped/complete (or v6 historical); moved from active lane to 70-done._

**Signed-off-by:** Claude Opus 4.8 — closure verified via task-board audit (subagent-assisted) against `src/` + `git log` on 2026-06-26.
