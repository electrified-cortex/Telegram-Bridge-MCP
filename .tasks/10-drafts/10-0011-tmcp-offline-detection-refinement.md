---
title: "Fix appears-offline detection logic — suppress false alarms"
created: 2026-06-15
updated: 2026-06-22
status: draft
priority: 20
type: Fix
source: Operator voice msgs 75555-75556
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# TMCP: Fix "appears offline" detection logic

**Filed:** 2026-06-15 ~18:00 PT  
**Source:** Operator voice msgs 75555-75556  
**Owner:** TMCP domain agent  
**Priority:** 20

## Problem

TMCP fires an "appears offline" notification to the operator when a pod hasn't dequeued recently, even when:
- The queue is empty (nothing to dequeue), or
- The pod has an active SSE subscription (they ARE listening)

This produces false alarms. Operator saw this for agent.

## Correct Behavior (per operator)

"Offline" should only trigger when ALL of:
1. Something is in the queue (pending message)
2. Agent has been notified via SSE at least once about that message
3. No response (no dequeue) for **5–10 minutes** (operator preference: 10 min)

An agent with an open SSE subscription and an empty queue = **online and idle, not offline**.

## What NOT to do

- Do not fire "offline" just because no dequeue has happened recently
- Do not fire "offline" if the queue is empty
- Do not fire on first notification — give a grace period

## Notes

- Grace window: 5 minutes minimum, 10 minutes preferred (per operator)
- This is a TMCP bridge-level change, not an agent-side change

## Acceptance Criteria

AC1. TMCP does NOT fire "appears offline" when the session queue is empty, regardless of how long since last dequeue.

AC2. TMCP does NOT fire "appears offline" when the session has an active SSE subscription (listener connected), regardless of how long since last dequeue.

AC3. "Appears offline" fires only when ALL THREE conditions are true simultaneously:
  - The session has ≥1 pending message in queue, AND
  - That message has been notified via SSE at least once to the session, AND
  - No dequeue has occurred for ≥10 minutes since the first SSE notification for that message.

AC4. Grace period: the 10-minute clock starts from the FIRST SSE notification for a given pending message — not from when the message was enqueued.

AC5. Existing test coverage updated to reflect new conditions; no regressions in other offline-detection paths.

AC6. The TMCP module responsible for the offline timer must locate the offline-detection logic (grep for "appears offline" or "offline" in bridge source) and update only that logic — no collateral changes.

## Open questions for Overseer spec review

Q1. Where exactly is the offline-detection timer in the TMCP codebase? (Worker to locate — but Overseer should confirm the right file before dispatch.)
Q2. Should the 10-minute default be configurable via a deployment env var (`TMCP_OFFLINE_GRACE_MS`)? Operator preference: 10 min. Configurability TBD.
Q3. What happens if SSE connection drops before the agent dequeues — does the clock stop, reset, or continue?
