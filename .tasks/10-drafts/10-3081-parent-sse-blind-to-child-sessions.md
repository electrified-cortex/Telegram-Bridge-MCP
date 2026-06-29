---
id: 10-3081
title: "TMCP: Parent SSE notify does not propagate from child sessions"
priority: P1
status: draft
category: Bug
filed: 2026-06-28
source: TG 80243
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: worker/tmcp-p4-child-sse-notify
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
---

# 10-3078: Parent SSE Blind to Child Session Activity

## Problem

When a parent session (SID N) spawns child sessions via `session/spawn-child`, inbound
messages routed to a child session do NOT fire a `data: notify` on the parent's SSE
subscription. The parent's dequeue loop sees nothing — it is blocked waiting on its own
token and cannot detect child session activity without polling each child token separately.

Result: a parent agent running a blocking `dequeue()` is effectively unreachable while the
operator is conversing with a child session. The parent must be interrupted or a separate
polling loop must be run — defeating the purpose of a hierarchical session model.

## Expected behavior

- Parent's SSE `data: notify` event fires when any child session in its tree receives an
  inbound message
- Parent `dequeue()` still returns only messages targeted to the parent's own SID
- The notify signal crosses the parent-child boundary as a wake signal only
- Child session dequeue remains the correct place to consume child-targeted content

## Operator statement (TG 80243)

Operator confirmed this is a bug: sub-sessions should not affect the parent SSE at all
in terms of routing, but the parent MUST receive the wake signal.

## Scope

The fix lives in the SSE broker / notify dispatch path. When a notify is emitted for a
session (SID), the broker should walk up the parent chain and fire notify on all ancestor
SSE subscriptions.

- Identify where `data: notify` is emitted for inbound messages (likely `src/session/` or
  `src/broker/` or the message router)
- Add parent-chain propagation: when firing notify for SID N, also fire for SID N's parent
  (if any), and the parent's parent, up to the root session
- Depth limit: walk at most N levels (e.g. 4) to prevent runaway loops on malformed trees
- Existing single-session behavior unchanged (no parent → same as today)

## Acceptance Criteria

- [ ] When SID 2 (child of SID 1) receives an inbound message, SID 1's SSE connection
      emits `data: notify` within the same dispatch cycle
- [ ] SID 1's `dequeue()` response does NOT include the child-targeted message content —
      only the notify signal propagates, not the payload
- [ ] Grandchild propagation: SID 3 (child of SID 2, child of SID 1) receiving a message
      fires notify on both SID 2 and SID 1
- [ ] Sessions with no parent (root sessions) are unaffected — behavior identical to today
- [ ] Unit test: mock parent+child session tree; inbound message to child asserts parent
      SSE notify called; parent dequeue does NOT return child message
- [ ] `npm run build` passes; existing tests pass

## Worker notes

- Start at the notify dispatch site — search for where `data: notify\n\n` is written to
  SSE clients, or where the notify event is emitted to subscribers
- Session parent linkage is set at `session/spawn-child` time — find where `parent_sid`
  is stored in session state
- Propagate upward: `notify(sid) → notify(parent_sid) → notify(grandparent_sid) → ...`

## Worktree

Branch: `worker/tmcp-p4-child-sse-notify`
Directory: `.git/.wt/tmcp-p4-child-sse-notify`
Base: `main` at current HEAD
