# TMCP: Warn on dequeue(max_wait:0) with active activity subscription

**Source:** Operator directive 2026-06-22 (dogfood session)  
**Routes to:** TMCP `.tasks/00-ideas/` via Overseer  
**Priority:** P1 — behavioral guard; prevents the drain-and-idle anti-pattern at runtime

---

## Problem

When an agent has an active activity subscription (SSE via `activity/listen` OR file-watch via `activity/file/create`), calling `dequeue(max_wait: 0)` is the anti-pattern. The agent should call blocking `dequeue()` (session default) and loop until `timed_out: true`. The subscription handles waking the agent for the next cycle.

This went undetected today (2026-06-22): Curator called `max_wait: 0` on every SSE wake because memory encoded it as the "drain-and-idle" idiom. No runtime signal corrected it.

**Related spec:** `tmcp-dequeue-pattern-behavioral-nudge.md` covers a different case (re-polling after `timed_out`). This spec covers the upstream case: using `max_wait: 0` at all while subscribed.

---

## Proposed behavior

When a session with an **active activity subscription** (SSE or file-watch) calls `dequeue(max_wait: 0)`:

1. Serve the call normally (do not block it — startup drain is a valid exception).
2. **Inject a `behavior_nudge` service message** into the response alongside any updates:

```json
{
  "event": "service_message",
  "content": {
    "type": "service",
    "event_type": "behavior_nudge_max_wait_zero_with_subscription",
    "text": "⚠️ You called dequeue(max_wait: 0) while an activity subscription is active. This is the drain-and-idle anti-pattern: it bypasses the blocking loop and prevents idle detection. Correct pattern: dequeue() with NO max_wait → handle → repeat until timed_out: true. Your subscription wakes you for the next cycle — you do not need instant polls."
  }
}
```

3. **Grace rule:** suppress the nudge if:
   - This is the first `max_wait: 0` call since session start (startup drain — R3)
   - OR fewer than 2 `max_wait: 0` calls since last subscription arm (one-shot checks are acceptable)

4. **Nudge once per session then back off** — do not spam on every subsequent `max_wait: 0` call in the same session. Re-arm after subscription is re-established.

---

## Acceptance criteria

- AC1: Session with SSE active calls `dequeue(max_wait: 0)` twice → second call includes `behavior_nudge_max_wait_zero_with_subscription` service message in response
- AC2: First `max_wait: 0` call after `session/start` (startup drain) → NO nudge
- AC3: Session WITHOUT active subscription calls `dequeue(max_wait: 0)` → NO nudge (polling valid)
- AC4: Nudge fires at most once per subscription lifetime (re-armed on `activity/listen` re-call)

---

## Implementation notes

- Track per-session: `maxWait0CallCount: number` (reset on subscription arm)
- Active subscription check: session has a live SSE subscriber OR a registered file-watch path
- Nudge type: `behavior_nudge` family — already suppressed from SSE notify trigger (won't wake the monitor loop, arrives as in-band update only)
- Complements `behavior_nudge_dequeue_pattern` (re-poll after timeout); these cover different failure modes

---

## Companion cleanup

Once this is implemented, the standing memory fix (2026-06-22) in `feedback_never_explicit_max_wait.md` remains as the agent-side guard. Bridge-side + memory-side = belt and suspenders.

---

## Overseer review

- **Reviewer:** Overseer (SID 2)
- **Date:** 2026-06-25
- **Verdict:** PASS — **RESTORE APPROVED by operator 2026-06-25** (cleared for foreman as the 3rd sequential task).
- **Review type:** Adversarial spec gate + git-history check + operator decision
- **History:** Implemented on release/7.15.0 as commit `b6d2f52a`, then reverted by `6332e11a` (10-3033, "surgically remove max_wait:0 drain-and-idle nudge"). Revert reason was **UNDOCUMENTED** (no 10-3033 task file). Operator's call: the revert was a mistake; the nudge belongs in the product. Verified the revert was CLEAN — only the nudge was removed (8 files plumbing + logic + ~145 test lines); no collateral; the unrelated 10-3031 start.test.ts change was preserved.
- **Restore approach (BINDING):**
  1. Re-apply `b6d2f52a` (revert-the-revert / cherry-pick) onto dev as the starting point — full implementation + tests are recoverable there.
  2. **HARDEN the grace rules** so the nudge NEVER false-fires on LEGITIMATE max_wait:0 usage (most-likely original revert cause):
     - startup drain (first call after session/start) — already exempt; keep.
     - post-kick BACKLOG DRAIN: after a Monitor/SSE kick, an agent legitimately calls dequeue(max_wait:0) repeatedly until pending=0. MUST NOT nudge while a drain is actively returning messages. (Verify the spec's "messages delivered in window" grace fully covers a multi-call drain.)
     - file-watch fallback loop ("on each kick → dequeue(max_wait:0) until pending=0") — MUST NOT nudge.
  3. Add explicit tests proving NO false-fire on each legitimate case above, PLUS the true-positive (idle busy-poll with active subscription → nudge once).
- **Not checked:** implementation correctness — post-impl PR gate (Overseer adversarial review before any push).
- **Delegation:** worker implements → foreman verifies ACs (operator directive 2026-06-25).

---

## Verification

- **Verifier:** Foreman (adversarial review — Overseer gate)
- **Date:** 2026-06-26
- **Verdict:** APPROVED
- **Overseer review:** PASS (2026-06-26, re-gate after grace-B defect fix)
- **Tests:** 3926/3926 pass, lint clean
- **Commits:** `982564dd` (cherry-pick b6d2f52a + conflict resolution), `4f27a9fe` (grace-B/C fix + tests)
- **Squash on dev:** `2c34349`
- **Notes:** Cherry-pick b6d2f52a applied cleanly with 10-3028 conflict resolved. Grace hardening: _maxWait0State.delete(sid) on all batch-return paths prevents false-fire on post-kick drains. AC-grace-B, AC-grace-C, and true-positive tests added. resetMaxWait0NudgeState re-arms on activity subscription re-establish.
