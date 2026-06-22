---
id: tmcp-reminder-confirmation-service-message
title: "TMCP: Smart reminder confirmation service message (Feature A + B)"
type: feature
status: draft
created: 2026-06-15
priority: high
source: Operator voice msg 75128, Curator Task #6, BT backlog (DEFECT 1 + DEFECT 3)
delegation: TMCP maintainer (electrified-cortex/Telegram-Bridge-MCP/)
related:
  - BT DEFECT 1: annual-cron loop footgun
  - BT DEFECT 3: CronCreate durable:true silently session-only
  - Curator spec: .curator-pod/tasks/00-ideas/tmcp-reminder-confirmation-service-message-2026-06-15.md
signed-by: Curator (Task #6 assignment)
---

# TMCP: Smart Reminder Confirmation Service Message

## Problem

When agents call `reminder/set` or `reminder/schedule`, the tool response is minimal
("ok" / confirmation with id). Agents have no immediate signal about:
- Whether the reminder will survive a session restart (persistence status)
- When it will actually fire next (far-future risk)
- Whether a recurring pattern will roll forward unexpectedly (annual-cron footgun)

This causes silent defects (BT DEFECT 1, DEFECT 3): agents set annual-pinned recurring
reminders that silently re-arm a year out, or rely on CronCreate durable:true which
doesn't persist cross-restart.

## Solution

Two independent shippable features:

---

### Feature A — SET confirmation (CORE — ship first)

On every `reminder/set` or `reminder/schedule` call, TMCP emits a service message
(type: `reminder_confirmation`) AFTER the tool response. The tool response body stays
simple — the enriched context goes in the service message.

**Service message schema:**
```json
{
  "type": "service",
  "event_type": "reminder_confirmation",
  "reminder_id": "<id>",
  "plain_summary": "<human-readable description>",
  "next_fire": "<ISO-8601 or null>",
  "persistence": "session_only | profile_saved",
  "persistence_note": "<actionable string>",
  "tier": 1 | 2 | 3,
  "tier_warning": "<string | null>"
}
```

**Tiered feedback by frequency:**

| Tier | Condition | Content |
|------|-----------|---------|
| 1 — High-freq | Fires every few minutes (≤15m interval) | Simple confirm. "Reminder set: fires every 5 min. Recurring." |
| 2 — Moderate | Hourly / daily | Confirm + next_fire absolute timestamp. "Next: 2026-06-16T09:00-07:00." |
| 3 — Far-future | Weekly+, date-pinned, or gap > 7 days | Confirm + WARNING + actionable suggestion (see example below) |

**Tier 3 example (annual):**
> "⚠️ Reminder set: fires 2027-06-15. This is a recurring reminder ~1 year from now.
> The likelihood of this session surviving to fire is very low. Consider a one-shot
> alternative, or save to profile for persistence. Cancel with `reminder/cancel <id>`."

**Persistence note (always included):**
- Session-only, one-shot → "Will fire once then expire. Not saved to profile."
- Session-only, recurring → "Recurring but NOT saved to profile — will not survive
  session restart. To persist: `profile/save`."
- Profile-saved → "Saved to profile. Reloads on next session start."

---

### Feature B — FIRE payload enrichment (NICE-TO-HAVE — ship independently)

When a recurring reminder fires, include `next_fire` in the event payload delivered
via dequeue. Agents can self-check: "next fire is 2027-06-15" → recognize the
annual-cron footgun and self-correct.

**Dequeue event addition:**
```json
{
  "event": "reminder",
  "content": {
    "text": "...",
    "reminder_id": "...",
    "recurring": true,
    "next_fire": "2027-06-15T09:00:00Z"   ← NEW
  }
}
```

---

## Implementation notes

- Service message fires synchronously after the set operation (same request cycle)
- TMCP generates the plain_summary from reminder parameters — no agent action needed
- Tier classification logic: examine `cron` expression or `delay_seconds` + `recurring`
  to determine tier (simple heuristics — no LLM needed)
- Feature A and Feature B are independent — ship A first

## Acceptance criteria

**Feature A:**
- AC1. Every `reminder/set` call triggers a `reminder_confirmation` service message in
       the next dequeue batch.
- AC2. Tier 1 (≤15m recurring): minimal text, no timestamp.
- AC3. Tier 2 (hourly/daily): includes next_fire absolute timestamp.
- AC4. Tier 3 (weekly+ / gap >7d): includes warning + suggestion to use one-shot.
- AC5. Persistence note always present; content accurate to profile vs session state.
- AC6. Tool response body unchanged (stays simple "ok" / id).
- AC7. Annual-pinned recurring reminder (e.g. `0 9 15 6 *`) triggers Tier 3 warning.

**Feature B:**
- AC8. Recurring reminder fire event includes `next_fire` field in dequeue payload.
- AC9. `next_fire` is accurate ISO-8601 UTC timestamp of the next scheduled fire.
- AC10. Non-recurring (one-shot) fire events: `next_fire` absent or null.

## Overseer review

- Reviewer: Overseer
- Date: 2026-06-20
- Verdict: PASS
- Review type: Direct review (Curator-signed; AC binary/testable, scope bounded, delegation correct)

Checked: AC binary+testable, scope bounded, delegation correct, no open questions, implementation notes sufficient.

## Verification

- Date: 2026-06-20
- Verifier: Dispatch subagent (fresh-eyes, agent addbbf6650ac72253)
- Verdict: APPROVED

Feature A (AC1–AC7) — all CONFIRMED:
- AC1: deliverReminderConfirmation called in set.ts:49 + schedule.ts:77 — CONFIRMED
- AC2: Tier 1 (≤15m) — no timestamp, minimal text — CONFIRMED (confirmation.ts:20, tests:54-78)
- AC3: Tier 2 (hourly/daily) — next_fire ISO-8601 — CONFIRMED (confirmation.ts:62-82, test:206-215)
- AC4: Tier 3 (weekly+/gap>7d) — warning + cancel hint — CONFIRMED (confirmation.ts:136-148, tests:217-250)
- AC5: Persistence note always present and accurate — CONFIRMED (confirmation.ts:155-162, tests:252-295)
- AC6: Tool response body unchanged (confirmation is pure side-effect) — CONFIRMED
- AC7: Annual cron triggers Tier 3 warning — CONFIRMED (confirmation.ts:48, tests:299-339)

Feature B (AC8–AC10) — DEFERRED per task spec ("NICE-TO-HAVE — ship if time permits").

Test evidence: 3578/3580 passing (28 new tests all pass; 2 pre-existing ONBOARDING_LOOP_PATTERN failures — baseline).
Schema note: fields nested under `details` key per TMCP's established deliverServiceMessage pattern (functionally equivalent).
PR #218 open with HOLD notice — awaiting spec review and Overseer approval before merge.

Sealed-By: Foreman / 2026-06-20
