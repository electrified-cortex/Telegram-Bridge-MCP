---
created: 2026-06-28
status: done
priority: 1
source: Operator TG 80243 + 80247 + 80273, 2026-06-28
repo: electrified-cortex/Telegram-Bridge-MCP
type: Bug
severity: P0
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
---

# Task: TMCP — Child sessions MUST be isolated from parent SSE (P0)

**ID**: 10-3057 / child-sse-isolation
**Date**: 2026-06-28
**Priority**: P0
**Origin**: Operator TG 80243, 80247, 80248, 80273

## Problem

Child session SSE notify events were bleeding into the parent session's SSE stream. When the operator sent a message to a child session, the parent session's SSE received a `notify` event that should not be there.

**Operator TG 80273:** Operator confirmed child session notifications should not reach the parent SSE stream — this is a bug to be resolved.

**Operator TG 80279:** Operator clarified that only lifecycle events (session start/end) should reach the parent; no in-session notification traffic should bleed through to the parent.

## Required behavior

Parent SSE receives lifecycle events ONLY (session start/end). Individual message notify events during child session lifetime are isolated — parent receives NOTHING. Parent is not burdened by child's message traffic, tool calls, or dequeue activity.

## Fix

`src/session-queue.ts` — `deliverChildNotifyEvent`: removed two unconditional parent-wake calls:
- `notifySession(parentSid, "service", isDequeueActive(parentSid))`
- `notifyChannelSubscriber(parentSid, event)`

Replaced with comment: `// Intentionally no SSE notify and no channel wake (TG 80273 isolation)`

Event still enqueued via `q.enqueue(event)` for natural dequeue — child message readable via child token, not pushed to parent.

## Acceptance Criteria

- [x] AC1: Child message → parent SSE receives NO notify
- [x] AC2: Parent SSE fires ONLY for parent-targeted messages
- [x] AC3: Child blocking dequeue does NOT affect parent SSE dispatch independence
- [x] AC4: Multiple child blocking dequeues do NOT starve parent SSE
- [x] AC5: Parent's own messages still arrive via parent SSE (no regression)
- [x] AC6: Child SSE still fires for child-targeted messages (no regression)
- [x] AC7: Lifecycle events (SPAWNED/CLOSED) unaffected
- [x] AC8: New tests cover isolation (AC1) and independence
- [x] AC9: `tsc --noEmit` passes
- [x] AC10: All pre-existing tests pass

## Verification

- Worker (a281c844) 2026-06-28: COMPLETED — minimal fix in deliverChildNotifyEvent, 7 new isolation tests, 3936/3936 pass
- Verifier (af0cf608f5e7a99fe) 2026-06-28: **APPROVED** — worktree CLEAN; fix confirmed at session-queue.ts:659-663; AC1+2+5+6+7+8+9+10 all PASS; queue integrity preserved; test-plan.md + test-results.md present

## Sealed

- Sealed-By: Foreman 2026-06-28
- Squash: worker/10-3057-parent-sse-propagate-child-notify → dev
- Commit: e40d1ea0
- Tests: 3936/3936
