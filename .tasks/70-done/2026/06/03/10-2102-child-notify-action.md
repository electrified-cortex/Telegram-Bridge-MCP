---
id: 10-2102
title: child/notify action — child-to-parent structured event delivery
Created: 2026-06-02
Status: 50-active
Claimant: sid:36mbcb6eae8
Priority: high
Source: PRD 10-2100 (threaded conversations prerequisite); Overseer 2026-06-02
target_version: 7.8.1
Delegation: Worker
related: [10-2100, 10-2101]
---

# 10-2102 — child/notify action

## Problem

The threaded conversations pattern (10-2100) requires a child session to deliver structured reports to its parent's queue — routing reports (`thread/routed` from router → host) and completion signals (`thread/resolved` from thread agent → host). No TMCP tool currently exposes child→parent messaging. `child/forward` is parent→child only.

## Goal

Add `action(type: 'child/notify', token, event_type, payload?)` — a child session delivers a structured service event to its parent session's queue.

## Requirements

### R1 — New action path: child/notify
Parameters:
- `token` — child's session token (required)
- `event_type` — string, caller-defined (required). Max 64 chars, alphanumeric + `/` + `_` only.
- `payload` — JSON-serializable object (optional). Delivered verbatim.

### R2 — Authorization
- Caller must have a `parent_sid` (root sessions receive `UNAUTHORIZED`).
- All `child_capability` tiers may call `child/notify` — it is a messaging primitive, not a destructive action.

### R3 — Delivery
Enqueues a service event to the parent session's queue. Format delivered to parent's dequeue:
```json
{
  "event": "service_message",
  "from": "child",
  "content": {
    "type": "service",
    "event_type": "<caller's event_type>",
    "payload": { ... },
    "child_sid": <caller's SID>,
    "origin": "child_notify"
  }
}
```

Parent receives this on its next dequeue call. `child_sid` allows the parent to validate the sender without reading caller context.

### R4 — Validation
- Non-JSON-serializable payloads return `INVALID_PAYLOAD`.
- `event_type` that fails the format constraint returns `INVALID_EVENT_TYPE`.
- If parent session no longer exists (revoked between caller's check and notify): return `PARENT_SESSION_NOT_FOUND`.

### R5 — No routing side effects
`child/notify` does NOT trigger `SESSION_JOINED`, governor re-election, or any other session lifecycle event. It is a pure queue injection.

## Acceptance criteria

- [ ] AC1. `action(type: 'child/notify', token: <child_token>, event_type: 'thread/routed', payload: { thread_sid: 5, topic_label: 'billing' })` from a child session enqueues a service event to the parent's queue. Parent receives it on next dequeue with `from: "child"` and `child_sid` set correctly.
- [ ] AC2. Root session (no `parent_sid`) calling `child/notify` receives `UNAUTHORIZED`.
- [ ] AC3. `child_capability: 'read-only'` child can call `child/notify`. Not in the blocked list for any capability tier.
- [ ] AC4. Non-serializable payload returns `INVALID_PAYLOAD`.
- [ ] AC5. `event_type` with disallowed characters returns `INVALID_EVENT_TYPE`.
- [ ] AC6. Parent receiving the event can read `child_sid` and `event_type` without parsing the outer envelope beyond standard dequeue fields.
- [ ] AC7. No `SESSION_JOINED` or governor event fires as a side effect of `child/notify`.

## Out of scope

- The actual `thread/routed` and `thread/resolved` event handling logic — that is the host skill's responsibility (10-2100 Phase 2)
- Delivery guarantees / acknowledgement — no ACK mechanism; fire-and-forget to the queue
- Rate limiting — not in scope for v1

## Overseer review

- Reviewer: Overseer SID-3
- Date: 2026-06-02
- Verdict: PASS
- Review type: direct authorship (operator-directed; Curator unavailable)
- Checked: requirements complete, ACs binary and testable, scope bounded, authorization model sound, no open blockers
- Not checked: technical correctness of implementation (worker's job)

## Verification

- Verdict: APPROVED
- Verifier: dispatched sub-agent (independent)
- Date: 2026-06-03
- Commit: accf390 (squash of e97ce318)
- All 7 ACs confirmed by code inspection with citations
- Test gate: 3292 tests passing (143 test files, exit 0, vitest 4.1.7)
