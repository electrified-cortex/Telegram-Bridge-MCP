---
created: 2026-06-27
status: draft
priority: 10
source: comms-hardening-tomorrow (BT-7274 analysis)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# 10-0017 — activity/selftest endpoint (synthetic SSE verification)

## Context

BT's comms-permanence-hardening analysis (BT-7274) identified that SSE subscription health cannot be verified solo — the AC-1 self-notify filter (implemented in 10-0004) blocks agents from receiving their own injected events. The current workaround requires the operator to send a real message to confirm SSE receipt.

This task builds the structural fix: a server-side endpoint that injects a synthetic operator-sourced notify into the caller's own SSE stream, bypassing AC-1. With this endpoint, any agent can run a self-contained SSE liveness check without operator participation.

## Objective

Add a `POST activity/selftest` endpoint that injects a synthetic notify event into the authenticated caller's active SSE subscription. The event is structurally identical to a real operator notify but carries a `selftest: true` marker so agents can distinguish it. Eliminates the self-DM workaround.

## Acceptance Criteria

1. `POST activity/selftest` is authenticated (same bearer token as all other TMCP endpoints).
2. The endpoint injects a synthetic event into the caller's active SSE stream — event schema matches a real operator notify but includes `"selftest": true` in the payload.
3. The event bypasses the AC-1 self-notify filter (filter must not suppress selftest-sourced events).
4. The endpoint returns HTTP 200 `{sent: true}` when the event was successfully injected into an active subscription.
5. The endpoint returns HTTP 409 (or appropriate error) when the caller has no active SSE subscription to inject into.
6. An agent that calls `activity/selftest` and receives the event via its SSE stream can conclude the subscription is live — no operator action required.
7. Existing SSE behavior for real operator messages is unaffected.

## Scope boundary

- Adds `POST activity/selftest` handler only.
- Modifies AC-1 self-notify filter to pass events with `selftest: true` origin.
- Does not change SSE event schema for real operator messages.
- Does not replace the SSE subscription mechanism (10-0006 territory).

## Delegation

Executor: Worker / Reviewer: Curator

## Priority

Priority: 10 — high (removes operator dependency from SSE verification path)
