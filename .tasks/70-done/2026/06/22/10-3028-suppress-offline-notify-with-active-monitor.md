---
created: 2026-06-21
status: 10-drafts
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
related: 10-3029
---

# 10-3028 — Suppress dequeue-gap offline notification when agent has an active monitor

## Context

The bridge emits a "hasn't dequeued in too long → offline" notification as a safety signal for dequeue-only agents. This signal is a false alarm when the agent has an active SSE stream or activity-file subscription open, because the subscription itself proves connectivity. Dequeue gaps are expected and normal in monitor-driven agents.

## Objective

Gate the dequeue-gap offline notification on the absence of an active subscription, so that agents with a live SSE or activity-file monitor are never falsely flagged as offline.

## Acceptance Criteria

1. [x] Dequeue-gap offline notification does not fire for any session that has an active SSE subscription (`activity/listen`) registered with the bridge.
2. [x] Dequeue-gap offline notification does not fire for any session that has an active activity-file registration (`activity/file/create`) registered with the bridge.
3. [x] Dequeue-gap offline notification fires normally for sessions that have no active subscription and exceed the dequeue-gap threshold.
4. [x] If a session's subscription is lost or expired and the dequeue-gap threshold is exceeded, the notification fires.
5. [x] Existing behavior for dequeue-only agents (no monitor registered) is unchanged.

## Verification

APPROVED by verifier a10c735dedd57a3fd — all 5 ACs confirmed, absorbed into 10-0006 (136b9fba), 3705/3705 tests pass. Implementation: health-check.ts:239 isSseMonitorActive guard + file-state.ts export; health-check.test.ts:724–822 (5 AC blocks).

## Scope boundary

- Changes confined to the dequeue-gap offline-check logic only.
- Does not alter the threshold value, notification content, or delivery path.
- Does not modify SSE or activity-file registration behavior.

## Delegation

Executor: Worker / Reviewer: Overseer

## Priority

Priority: 10 — high
