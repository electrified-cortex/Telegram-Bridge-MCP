# TMCP: Fix "appears offline" detection logic

**Filed:** 2026-06-15 ~18:00 PT  
**Source:** Operator voice msgs 75555-75556  
**Owner:** TMCP domain agent  
**Priority:** 10 (standard)

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
