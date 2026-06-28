# Parent SSE Blind to Child Session Activity

**Source:** Operator TG 80243, 2026-06-27
**Status:** idea — confirmed bug
**Priority:** High

## Problem

When a parent session (SID 1, Curator) spawns child sessions (SID 4, SID 5), inbound messages that route to a child session do NOT fire the parent's SSE notify. The parent's dequeue loop receives nothing — it only sees messages routed directly to itself.

Result: the parent agent is effectively blind to all child session activity. The parent cannot monitor child sessions without actively polling each child's token separately — which defeats the purpose of the parent being in charge.

## Operator statement (TG 80243)

> "That can't be right. That's a bug! SUB SESSIONS should not affect YOUR SSE at all!!!!"

Operator expectation: parent SSE fires for ALL activity in the parent's session tree, including child sessions. Child session messages should propagate notify up to the parent.

## Expected behavior

- Parent SSE (`data: notify`) fires when ANY child session receives an inbound message
- Parent dequeue still only returns messages targeted to the parent's own SID
- But the NOTIFY signal crosses the parent-child boundary
- Child session dequeue is the correct place to consume child-targeted messages — parent just needs the wake signal

## Proposed fix

Propagate SSE `notify` events from child sessions up to the parent session's SSE subscription. Parent wakes, checks child token dequeues (or dispatches sub-agent to do so), stays aware.

Alternatively: the sub-agent running the child session should own the dequeue loop, but the parent must still receive the notify so it knows the child is active.

## Impact

Without this fix:
- Parent agent appears unresponsive to operator when conversation is in a child session
- Parent cannot detect when child sessions need intervention
- Operator frustration: messages go unanswered while parent is polling a blocking dequeue

## Related

- Spawned-child sub-agent pattern requires parent visibility
- `session/spawn-child` design assumed parent awareness of child activity
