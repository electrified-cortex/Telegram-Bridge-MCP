---
title: Dequeue throttle — detect sub-timeout / zero-result rapid dequeues, warn + exponential backoff
filed: 2026-06-10
source: operator voice (Telegram msg 71117) — Decision-C discussion
relates: worker/10-2001-runaway-dequeue-rate-guard (the planned "throttle"); notification-wake-contract-SPEC.md §7-C
target: ~7.10.1 (post-7.10; the 7.10 wake contract ACCEPTS the starvation foot gun as-is)
status: draft / needs spec
---

## Problem (operator)
An agent that dequeues at intervals **shorter than the configured reminder-inactivity timeout** (e.g. dequeue every 30s when reminders fire after 60s idle) **silently blocks its own reminders forever** — it never accrues 60s of idle, so time/active reminders never fire. This is a real, observed foot gun. Separately: an agent that rapid-fires **zero-result** dequeues (pending=0, no messages) just **burns tokens** in a pointless loop.

## Proposed feature (operator design — capture faithfully)
TMCP-side detection + corrective response:
1. **Sub-timeout dequeue detection:** if an agent has done many dequeues all at intervals **< the configured reminder timeout** (e.g. 10 dequeues all ~37s apart), TMCP sends a **service message**: "you've been dequeuing too fast for too long — you're missing reminders."
2. **Zero-result rapid-fire detection:** if an agent dequeues and gets **zero results N times in a row** (operator floated ~5), especially when `pending` already says no messages → service message: "you're burning tokens dequeuing into nothing — slow down." (Detect the wasteful loop.)
3. **Exponential backoff handler:** on detected rapid/zero dequeuing, TMCP inserts a backoff before honoring the next dequeue — wait 5s, then double to 10s, then keep doubling — penalizing the wasteful behavior. MUST NOT itself become an infinite service-message loop (cap / be smart).
4. **Exemption — busy ≠ idle:** an agent **sending messages** is legitimately busy → exempt. The problem is ONLY the idle dequeue-loop at sub-timeout intervals / zero-result rapid-fire.

## Connection
This is the **throttle that was planned** ("supposed to be in there") — likely extends/overlaps `worker/10-2001-runaway-dequeue-rate-guard`. Review together; don't duplicate.

## 7.10 decision (C)
For the 7.10 wake contract, the starvation foot gun is **ACCEPTED as-is** (operator: "we can get away with the known foot gun here"). This throttle feature is a **separate ~7.10.1** follow-up.
