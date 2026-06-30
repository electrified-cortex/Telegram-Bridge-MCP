---
id: 20-1903-bt2229-swarm-review-open-findings
title: "Unit-12-2229 v7.9.0 swarm-review — open findings (post-PR #206 follow-up)"
Created: 2026-06-09
Status: queued
Priority: 20
type: followup
Source: Overseer swarm review of dev-7.9 (6 reviewers + arbitrator), foreman outbox swarm-review-dev-7.9.md
---

# Unit-12-2229 v7.9.0 — open swarm-review findings (captured so nothing is lost)

Full report (durable copy this captures from):
`.foreman-pod/messages/outbox/swarm-review-dev-7.9.md`

## BLOCKER 0 — PARTIAL (sweep kicks file: 994647da) — but BLOCKER 0b (lockout) still open. NOT MERGING.

### 0a — sweep now kicks the activity file (FIXED, 994647da)
sweep calls `kickIfAllowed(sid,"reminder",false)` alongside `kickSseSubscriber`. Test proves it.

### 0b — parked agent can miss a reminder wake due to a STALE post-timeout lockout (OPEN)
**Operator corrected the framing (2026-06-09): the debounce/lockout is CORRECT — a kick means
"you have something to dequeue"; if you haven't dequeued yet, more events don't need more kicks
(you get them all via the in-loop check when you dequeue). A reminder must NOT bypass the
debounce.** (An earlier "direct-touch bypass" approach was incorrect; reverted.)

**Verified mechanism:**
- Agent IN its dequeue loop = FINE: waitMs targets the next fire (`scheduleFireMs`, dequeue.ts:469),
  it wakes at the fire, popFireableScheduleReminders returns it, content-exit calls
  releaseKickLockout (dequeue.ts:428,520-521) -> lockout reset. No drop.
- FULLY-parked agent whose last dequeue TIMED OUT = the gap: timeout exits deliberately DON'T
  reset the lockout (`_lockoutRelease` false, dequeue.ts:511,520). So it parks holding a lockout.
  A reminder due in that window: sweep's kickIfAllowed suppressed (file-state.ts:325-328), not
  re-delivered (not pending-user-content) -> agent not woken until it dequeues for another reason.

**SEVERITY RE-ASSESSED DOWN — narrow edge, NOT load-bearing:**
- Not a pre-existing bug. Messages NEVER leave a stale lockout: a message/service kick is always
  followed by a CONTENT dequeue that calls releaseKickLockout -> cleared. So a parked agent never
  carries a stale lockout from a message.
- The ONLY non-content-corresponding kick is the reminder KICK-AHEAD (sweep wakes up to 6s before
  next_fire_ms). So a reminder is the one case that could leave a stale lockout.
- Even then, the dequeue's `waitMs` holds the agent until the fire (scheduleFireMs, dequeue.ts:469),
  so any normal long-poll catches the reminder + clears the lockout. The miss only happens with a
  SUB-6-SECOND dequeue timeout — unusual. So 994647da is functionally correct for realistic use.

**Optional belt-and-suspenders (proposed, pending operator decision):** also release the lockout
on timeout exits (matches operator's "debounce resets when you dequeue" model). Closes the <6s-timeout
edge. NOT load-bearing — only worth it if operator wants the core gate touched. Code skips it today
to rate-limit "wedged" agents (rationale thin: a polling-and-timing-out agent isn't wedged).

Original finding (for the record):
**Scheduled reminders fire (in-loop dequeue check works) but did NOT wake an agent parked on
its activity-FILE monitor — which is how Unit-12 (the intended user) and Curator park.** The
feature was effectively undelivered for file-parked agents.

- Sweep (`reminder-state.ts:113`) calls ONLY `kickSseSubscriber(sid)` when due. SSE-only.
- `kickSseSubscriber` (`sse-endpoint.ts`) = `res.write("data: kick")`, does NOT touch the activity file.
- The activity-file kick is `kickIfAllowed` (touches file via doTouchWithRollback). dequeue.ts
  calls it (`:358`, `:524`) but ONLY while the agent is already dequeuing — can't wake a parked agent.
- Unit-12 parks on `bash monitor.sh` on the bridge activity FILE (Unit-12 handoff), not SSE.
- Result: SSE-parked agents wake; activity-file-parked agents (Unit-12, Curator) do NOT — reminder
  only fires when they next dequeue for another reason.

**FIX (one line):** in the sweep tick, also call `kickIfAllowed(sid, "reminder", false)`
alongside `kickSseSubscriber(sid)`, so a due reminder touches the activity file and wakes
file-parked agents. Add a test. (Flagged in spec §R-5 — "also call kickIfAllowed to wake
activity-file-parked agents" — but impl did SSE-only. MUST fix before deploying to Unit-12.)

## Status of the 5 critical blockers

Fixed in commit `60e335ae` (on dev-7.9 / PR #206 once pushed):
- [x] **B1** infinite loop in catch-up while loop (croner boundary) — guarded
- [x] **B2** apply.ts validation bypass — resolveIana/validateIana added on restore path
- [x] **B4** IDOR on cancelReminder via unschedule — session-ownership check added
- [x] **B5** sweep multiple-kick race — per-reminder last-kicked dedup added

STILL OPEN:
- [ ] **B3 (CRITICAL, deferred): domain→transport layering violation.** `reminder-state.ts`
  imports `kickSseSubscriber` from `sse-endpoint.js` (confirmed still present at
  `reminder-state.ts:16`, used :113). Domain can't be tested without SSE transport; a 2nd
  transport requires editing domain code. Fix: inject the kick callback at module init; domain
  never names the transport. Architectural, not a runtime bug — was deferred from the v7.9.0
  ship, MUST be done before adding any second transport.

## Open non-critical findings (security/correctness — triage for v7.9.1)

- [ ] **Log injection** (Security): raw `cron`/`tz` interpolated unescaped into error messages
  (`Got N field(s): "${cron}"`). Sanitize/truncate before interpolation.
- [ ] **IDOR also on reminder/schedule replace** (Security/DA): caller-supplied `id` on the
  schedule handler has the same missing session-ownership check that B4 fixed for unschedule.
  Verify + add the guard on the schedule path too.
- [ ] **profile/import delay_seconds now optional** (Designer): semantic contract change, no
  migration signal — callers defensively filling missing fields could silently corrupt schedule
  reminders. Add a migration/validation signal.
- [ ] **cron excluded from reminderContentHash** (DA/Designer): two schedule reminders, same
  text, different cron silently collide; no `replaced: true` signal. Include cron in hash or
  return replaced status.
- [ ] **Sweep leaks on disable** (DA/Engineer): `_scheduleSids` not pruned when a reminder is
  disabled (only on cancel/clear). A session with only disabled schedule reminders leaks the
  sweep indefinitely.
- [ ] **getCallerSid() context in apply.ts** (Engineer): `scheduleReminder` calls
  `getCallerSid()` internally; apply.ts may run outside request context -> wrong sid. Verify.
- [ ] **TZ alias ambiguity silent** (DA): `EST` -> America/New_York, but some systems mean
  Australia. No alias-expansion warning in the response.

## Designer / API surface (triage)

- [ ] reminder/unschedule not type-scoped — cancels ANY reminder type; name implies
  schedule-only. Enforce type or consolidate with reminder/cancel.
- [ ] `INVALID_TIMEZONE` "(resolved to 'X')" noise when X === input — only show on real alias
  expansion.
- [ ] reminder/list heterogeneous response — document the delay-vs-schedule field sets as an
  explicit tagged union (discriminated by `trigger`).

## Minimalist cleanup (low priority)

- Dead code `r.cron ?? ""` in save.ts; duplicated §G-3 / §G-A comments; duplicated cron example
  in action.ts; redundant §R-6 comment; Unit-12 scar-tissue comment.

## Test-infra (caught during v7.9.0 verification)

- [ ] **Flaky timeout in `openai-schema-compat.test.ts`** — `collects all registered tools`
  does `await import("./server.js")` with the default 5s timeout. Under full-suite load
  (import phase ~85s on a slow/loaded machine), the cold import exceeds 5s and times out,
  cascading to the 2 dependent assertions (`captured.length` 0 vs 4). Passes 5/5 in isolation
  with warm imports. NOT related to reminder/schedule. Fix: pass an explicit `testTimeout`
  (e.g. 30000) to that test.

## Note

Swarm confidence: MEDIUM (B1 infinite-loop depends on croner version-specific boundary
semantics not verified against live lib — a targeted integration test would raise to HIGH).
Recommend adding that integration test.

## Verification

**Verdict:** APPROVED
**Date:** 2026-06-12
**Verifier:** Dispatch agent adbd5896310409650 (independent, read-only)
**Branch:** worker/bt2229-open-findings (7 commits squash-merged to dev)
**Tests:** 147 files / 3416 passing — clean

### Criteria confirmed
- C1 B3 Arch — `reminder-state.ts` decoupled from SSE transport via `setReminderFireCallback` (reminder-state.ts:87-89, session-queue.ts:658)
- C2 Log injection — `sanitize()` at schedule.ts:14-16 applied to `cron`/`tz`
- C3 IDOR schedule replace — ownership guard at schedule.ts:54-60
- C4 Sweep leak on disable — `_scheduleSids.delete(sid)` at reminder-state.ts:342-347 + 4 new tests
- C5 `getCallerSid` context — `runInSessionContext` wraps `applyProfile` at apply.ts:18
- C6 TZ alias note — `note` field emitted when resolvedTz ≠ tz at schedule.ts:86
- C7 Flaky timeout — `{ timeout: 30_000 }` at openai-schema-compat.test.ts:128,152,182
- C8 Cleanup — dead `r.cron ?? ""` removed at save.ts:69

### Deferred (not in scope)
- BLOCKER 0b stale lockout — pending operator decision
- Designer/API surface items (5) — pending sign-off
- profile/import delay_seconds migration signal
- cron excluded from reminderContentHash
