# Last-received only-if-silent reminder

**Captured:** 2026-05-24 (PT, late)
**Source:** operator voice msg 61116
**Status:** Draft for Overseer review

---

## Summary — msg 61116

> Source: operator voice msg 61116, 2026-05-24 (distilled).

Request to augment the existing reminders with a flag/toggle: for a last-received reminder, if
a reply has already been sent since the inbound message, the recipient has taken action and no
reminder is needed. This calls for a new reminder type along the lines of "last received" /
"last unreplied".

---

## Conceptual model

The existing `last_received` reminder fires after N seconds of no new qualifying inbound message. **It does NOT consider whether the agent has REPLIED.** Operator's refinement: if the agent has sent any reply since the most recent inbound, the reminder should be SUPPRESSED (agent already acknowledged).

This is an AND condition: fire only if (no new inbound in N seconds) AND (no outbound since the last inbound).

## Two implementation paths

**A. New trigger:** `trigger: "last_received_unreplied"` — independent reminder type with AND logic.

**B. Flag on existing:** add `only_if_silent: true` option to `trigger: "last_received"`. Reminder fires only when last outbound predates the last qualifying inbound.

Lean: option **B** (flag). Reuses existing infrastructure; cleaner schema; operator-friendly toggle. The default `only_if_silent: false` preserves existing v7.6.0 behavior.

## Reset/suppress logic with `only_if_silent: true`

State machine:
- Track `last_qualifying_inbound_at` (existing)
- Track `last_send_at` (existing, used by `last_sent` reminder)
- A `last_received` reminder with `only_if_silent: true` fires only when:
  - `now - last_qualifying_inbound_at >= delay_seconds` (time condition)
  - AND `last_send_at < last_qualifying_inbound_at` (no reply has been sent since)
- If agent sends AFTER inbound, the reminder is SUPPRESSED (won't fire).
- If agent then RECEIVES another inbound, the clock resets and the reminder is re-armed.

## Use case

"If operator sends Unit-12 a question and Unit-12 replies, do not nudge. If operator sends Unit-12 a question and Unit-12 goes silent without replying, nudge after N seconds."

This matches the typical "have you forgotten about this?" pattern.

## Acceptance criteria

- **AC1**: `action({ type: 'reminder/set', trigger: 'last_received', mode: 'operator', delay_seconds: 180, only_if_silent: true })` registers an unreplied-flag reminder.
- **AC2**: Default `only_if_silent: false` preserves existing v7.6.0 behavior (fire on time alone).
- **AC3**: With `only_if_silent: true`, the reminder fires only when both conditions hold: elapsed since last qualifying inbound >= delay_seconds AND no outbound send has occurred between the inbound and now.
- **AC4**: Sending an outbound message AFTER the last qualifying inbound SUPPRESSES the reminder until the next qualifying inbound arrives.
- **AC5**: Multiple `last_received` reminders with different `only_if_silent` flags coexist independently.
- **AC6**: Persistent re-arm: after firing once, the reminder re-arms on the next qualifying inbound (same as base `last_received`).
- **AC7**: `recurring: false` one-off variant honored same as base trigger.
- **AC8**: `reminder/list` returns the `only_if_silent` flag value alongside other state fields.

## Open questions

- **OQ1**: Does `last_sent` need a symmetric `only_if_unanswered` flag? (Fire after agent's last send IF operator hasn't responded.) Lean: yes, but defer to a follow-up — keep this spec focused on the `last_received_unreplied` case.

## Delegation

- Spec author: Curator
- Vet + queue: Overseer
- Implementation: Worker pod with TMCP context

## Files in scope

- `src/reminder-state.ts` — add `only_if_silent` field to reminder schema; fire-condition checks both timestamps
- `src/tools/reminder/set.ts` — accept `only_if_silent` param
- `src/tools/reminder/list.ts` — surface flag in list output
- `src/reminder-state.test.ts` — new tests for unreplied state machine
- `src/tools/action.ts` — schema update

## Target

v7.6.1 (small extension of just-shipped v7.6.0).

---

## Overseer review

- **Reviewer:** Overseer
- **Date:** 2026-05-24
- **Verdict:** PASS
- **Review type:** adversarial-manual
- **Checked:**
  - Acceptance criteria: all 8 are binary and testable
  - State machine correctness: AND condition (`now - last_qualifying_inbound_at >= delay_seconds` AND `last_send_at < last_qualifying_inbound_at`) is sound; multi-inbound edge case handled correctly
  - Backward compat: `only_if_silent: false` default preserves v7.6.0 behavior
  - AC5 independence: per-reminder state, no cross-reminder coupling
  - Delegation: Curator-authored, Overseer-gated, Worker-implemented ✓
  - Scope: 5 specific files, bounded ✓
  - Open questions: OQ1 explicitly deferred with lean ✓
- **Not checked:** implementation correctness of state timestamps, test coverage adequacy
- **Notes:** Worker should handle null `last_send_at` as "never replied" (fire condition = true). Reconnect catch-up covered by base `last_received` logic via persisted timestamps — no additional spec needed.

## Claimant

Foreman session. Worker session: 5aa3cf56. Worktree: .foreman-pod/.worktrees/last-received-only-if-silent-reminder-2026-05-24

## Verification

- **Verdict:** APPROVED
- **Date:** 2026-05-25
- **Verifier:** task-verification sub-agent (a96e7209a2c654faa)
- **Squash commit:** 6289e4f6 (dev)
- **Test gate:** 3267/3267 tests pass, build clean
- **AC coverage:** AC1–AC8 all CONFIRMED with direct code citations
- **Notes:** `only_if_silent` flag correctly implements AND condition; `reminderContentHash` includes flag for independent coexistence (AC5); null `last_send_at` treated as never-replied per Overseer note.
