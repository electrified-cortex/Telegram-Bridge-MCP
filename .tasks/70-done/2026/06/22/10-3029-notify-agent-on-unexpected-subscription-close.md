---
created: 2026-06-21
status: 10-drafts
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
related: 10-3028
---

# 10-3029 — Notify agent on dequeue when subscription closed without explicit unsubscribe

## Context

When the bridge drops an agent's SSE or activity-file subscription unexpectedly (server restart, timeout, error) without the agent initiating teardown, the agent has no way to know. On their next dequeue they will receive no indication that their monitor is dead and they are no longer receiving wakeup events. This creates a silent connectivity failure.

## Objective

Inject a service message into the dequeue response when the bridge detects that a session's subscription was closed by causes other than an agent-initiated teardown, so the agent can detect and recover from silent monitor loss.

## Acceptance Criteria

1. [x] When a session's SSE or activity-file subscription closes without the agent calling `activity/listen` cancel, `activity/file/delete`, or `session/close`, the bridge records the close as unexpected.
2. [x] On the agent's next `dequeue` call after an unexpected close, the response includes a service message with `event_type: subscription_closed_unexpectedly` and text instructing re-arm.
3. [x] The service message is injected exactly once per subscription-loss event; subsequent dequeue calls do not repeat it.
4. [x] Agent-initiated teardown (`activity/file/delete`, `activity/listen` cancel, `session/close`) does not trigger the service message.
5. [x] Applies to both SSE (`activity/listen`) and activity-file (`activity/file/create`) subscriptions.

## Verification

- **Verdict:** APPROVED (verifier a124bb10135076361)
- **Squash commit:** 1d4ce2a8 on release/v7.11.1
- **Tests:** 3927/3927 pass (162 files) — conflict with dequeue-throttle resolved; both test blocks retained
- **Sealed:** 2026-06-22 by foreman

## Scope boundary

- Changes confined to subscription-state tracking and dequeue-response assembly.
- Does not modify the SSE stream, activity-file mechanism, or session-close logic.
- Does not attempt automatic re-arm — notification only.

## Delegation

Executor: Worker / Reviewer: Overseer

## Priority

Priority: 10 — high
