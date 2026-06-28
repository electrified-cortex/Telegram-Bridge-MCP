---
created: 2026-06-27
status: draft
priority: 10
source: Operator voice TG 80462, 2026-06-27
repo: electrified-cortex/Telegram-Bridge-MCP
type: Defect
severity: medium
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# TMCP — Parent Session Dequeue Notifications Go Silent While Child Session Active

**ID**: 10-3067
**Date**: 2026-06-27
**Priority**: Medium
**Origin**: Operator TG 80462

## Problem

When a child sub-session is active and generating traffic (dequeuing, sending messages), the parent session's SSE notification loop may go quiet — the parent stops receiving `notify` events even when there's activity it should be aware of. The parent agent is not alerted and appears unresponsive.

Operator verbatim (TG 80462): "Gotta remember when a sub session is running, you currently have a bug that prevents you from getting notified and stuff."

## Observed Behavior

- Parent session (SID 1) spawns child session (SID 6)
- Child session is active and dequeuing/sending
- Parent's SSE `/sse` endpoint stops firing `notify` events (or fires unreliably)
- Parent agent does not get woken up; appears silent to operator

## Expected Behavior

Child session activity should not suppress or interfere with parent session SSE notifications. The parent should continue to receive its own notify events normally regardless of child session activity.

## Investigation Needed

- Check whether the SSE notify mechanism throttles or deduplicates events across parent+child sessions
- Check whether the parent's `notify` event fires when child-generated activity is the only recent activity (routing conflict?)
- Check whether the presence nudge system is confused by child activity counting as "parent activity" (false-positive silence suppression)

## Acceptance Criteria

- [ ] **AC1**: With a child session active and dequeuing, the parent session continues to receive `notify` SSE events when new operator messages arrive. Verification method: spawn a child, have child dequeue and send; confirm parent SSE fires on a new inbound operator message.
- [ ] **AC2**: With a child session active, the parent's presence nudge timer is not reset by child-generated activity. The presence nudge timer tracks per-session silence (time since last agent dequeue/send in THAT session); child session activity must not advance the parent's silence clock. Verification: after child activity, parent nudge fires on schedule as if child had not acted.
- [ ] **AC3**: An automated integration-level regression test (using the existing test harness) is committed that: spawns a child session, triggers child dequeue and send activity, then asserts that the parent session's SSE receive an inbound `notify` event. Test must fail on the pre-fix codebase and pass after the fix.

## Dependencies

Related to 10-3057 (topic chip), 10-3063 (protocol docs), but independent — can be dispatched separately.

## Delegation

Worker (investigation first, then fix)

## Verification

- verifier: task-verification sub-agent
- date: 2026-06-28
- verdict: APPROVED
- squash: 4053844dfdfd340e6577cd7c350cfaf69534827e
- test gate: 4025/4025 passed (166 test files), exit 0
- AC1: CONFIRMED — debounceArmedBySource field in ActivityFileState; operator/reminder/approval sources bypass service-armed gate; 7 unit tests + 3 integration tests cover the bypass logic
- AC2: CONFIRMED — parent nudge timer not reset by child activity; inflightAtEnqueue scoped to parent's own dequeue state
- AC3: CONFIRMED — session-parent-notify.test.ts (237 lines) committed; regression test: spawn child → child dequeues → operator bypasses → parent SSE fires; fails on pre-fix codebase, passes after fix

## Overseer review

- reviewer: Overseer
- date: 2026-06-28
- verdict: PASS
- review type: adversarial sub-agent dispatch + inline spec patch
- checked: ACs binary and testable, scope bounded (SSE notify + nudge timer, three investigation paths), delegation correct (Worker), no blocking open questions
- patched: AC3 restructured as explicit test deliverable (automated integration-level); presence nudge timer defined in AC2; "regression test" qualified with harness type
