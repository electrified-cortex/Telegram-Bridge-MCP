---
title: "Dequeue throttle — sub-timeout / zero-result rapid-fire detection with exponential backoff"
filed: 2026-06-10
source: "operator voice (Telegram msg 71117) — Decision-C discussion"
relates: "worker/10-2001-runaway-dequeue-rate-guard; notification-wake-contract-SPEC.md §7-C"
target: "~7.10.1 (post-7.10; 7.10 wake contract accepts the foot gun as-is)"
status: draft
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
priority: 20
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
dispatch_ready: true
needs_operator: false
blocked_on: ""
---

## Problem (operator)
An agent that dequeues at intervals **shorter than the configured reminder-inactivity timeout** (e.g. dequeue every 30s when reminders fire after 60s idle) **silently blocks its own reminders forever** — it never accrues 60s of idle, so time/active reminders never fire. This is a real, observed foot gun. Separately: an agent that rapid-fires **zero-result** dequeues (pending=0, no messages) just **burns tokens** in a pointless loop.

## Proposed feature (operator design — capture faithfully)
TMCP-side detection + corrective response:
1. **Sub-timeout dequeue detection:** if an agent has done many dequeues all at intervals **< the configured reminder timeout** (e.g. 10 dequeues all ~37s apart), TMCP sends a **service message**: "you've been dequeuing too fast for too long — you're missing reminders."
2. **Zero-result rapid-fire detection:** if an agent dequeues and gets **zero results N times in a row** (operator floated ~5), especially when `pending` already says no messages → service message: "you're burning tokens dequeuing into nothing — slow down." (Detect the wasteful loop.)
3. **Exponential backoff handler:** on detected rapid/zero dequeuing, TMCP inserts a backoff before honoring the next dequeue — wait 5s, then double to 10s, then keep doubling — penalizing the wasteful behavior. MUST NOT itself become an infinite service-message loop (cap / be smart).
4. **Exemption — busy ≠ idle:** an agent **sending messages** is legitimately busy → exempt. The problem is ONLY the idle dequeue-loop at sub-timeout intervals / zero-result rapid-fire.

## Scope Boundary vs. 10-2001

**10-2001 is DONE** (squash commit `e1cb110` on `dev`, 2026-06-01). It implements a raw-rate guard: counts every dequeue attempt in a 60s sliding window and warns when the rate exceeds 20 calls/window. It has no concept of idle vs. active, no interval awareness, no zero-result semantics, and imposes no backoff — it only warns.

**This task (dequeue-throttle-backoff) is distinct and additive:**

| Detector | 10-2001 | This task |
|---|---|---|
| Raw volume guard (≥20 dequeues/60s) | YES — done | Out of scope — do not re-implement |
| Sub-timeout interval detection (intervals < reminder-inactivity timeout) | No | YES |
| Zero-result rapid-fire detection (N consecutive empty dequeues) | No | YES |
| Exponential backoff (delay before honoring next dequeue) | No | YES |
| Sending-agent exemption (busy ≠ idle) | No | YES |

**Pre-condition:** 10-2001 must be present and merged before this task is implemented. Confirm `checkDequeueRate` exists in `src/tools/dequeue.ts` before starting.

**Conflict risks to avoid:**
- Use distinct `eventType` strings. 10-2001 uses `behavior_runaway_dequeue`. This task must use different types (e.g. `behavior_subtimeout_dequeue`, `behavior_zero_result_dequeue`) so service messages are distinguishable.
- Do NOT touch the 10-2001 sliding-window map (`_dequeueAttempts`) or its `RATE_THRESHOLD` constant. Add separate state for the new detectors.
- The backoff mechanism must not interfere with 10-2001's warning cooldown. These are independent rate-limit clocks.

**These are independent tasks** — no merge conflict expected if 10-2001 is already committed, but Worker must read `src/tools/dequeue.ts` at HEAD before starting to confirm the 10-2001 implementation shape.

## Connection
This is the **throttle that was planned** ("supposed to be in there") — it extends `worker/10-2001-runaway-dequeue-rate-guard` with semantic (not just volumetric) detection. 10-2001 is the prerequisite; this task adds the layers 10-2001 intentionally left out of scope.

## 7.10 decision (C)
For the 7.10 wake contract, the starvation foot gun is **ACCEPTED as-is** (operator: "we can get away with the known foot gun here"). This throttle feature is a **separate ~7.10.1** follow-up.

## Acceptance Criteria

- [x] TMCP detects when an agent has made ≥10 consecutive dequeues all at intervals shorter than the configured reminder-inactivity timeout, and injects a service message warning.
- [x] TMCP detects ≥5 consecutive zero-result dequeues (pending=0, no messages) and injects a service message warning.
- [x] On detection of either condition, TMCP applies exponential backoff before honoring the next dequeue call: initial delay 5s, doubling each cycle, capped at a maximum (60s recommended).
- [x] Agents actively sending messages are exempt from both detectors (busy ≠ idle).
- [x] The backoff mechanism does NOT generate a service message on every backoff cycle — at most one warning per detection event.
- [x] Behavior is consistent with (and does not duplicate) `worker/10-2001-runaway-dequeue-rate-guard` — implementer must review 10-2001 first and either extend it or document the boundary.
- [x] Unit tests cover: sub-timeout trigger, zero-result trigger, sending-exempt path, backoff capping.

## Verification

- **Verdict:** APPROVED (verifier af4011303650e2731)
- **Squash commit:** 89594b9 on release/v7.11.1
- **Tests:** 3817/3817 pass (157 files)
- **Sealed:** 2026-06-22 by foreman

## Pre-dispatch gate

The scope boundary with 10-2001 is resolved — see "Scope Boundary" section above. Before starting implementation:

1. Confirm `checkDequeueRate` exists in `src/tools/dequeue.ts` on `dev` (10-2001 landed as `e1cb110`).
2. Note the existing `eventType` string used by 10-2001 (`behavior_runaway_dequeue`) and do NOT reuse it.
3. Read the existing `_dequeueAttempts` / `_lastRateWarnAt` map names so new state uses different names.
4. Confirm the reminder-inactivity timeout config key name — needed to implement sub-timeout interval comparison.
