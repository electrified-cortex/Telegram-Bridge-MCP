# TMCP sub-session UX bugs — operator-observed during sub-session test, 2026-05-25

Captured from operator voice msg 61404 (mid-day PT) — observations during the first live test of sub-session-dispatch infrastructure with a child session.

## What worked

- Sub-agent dispatched and ran to completion (~20 min, 64 tool uses, 93k tokens).
- Operator could interact directly with the child session and steer it (issued a directive that the sub-agent implemented).
- Parent session was not polluted by the side conversation.
- Child cleanly self-revoked on completion. Service messages (`child_session_resolved`, `session_closed`, `direct_message: 📢 Single-session mode restored`) all fired.

## What's broken or missing

Operator framed these as TMCP-side bugs / feature misses — not agent-side. Capturing for the TMCP queue.

1. **Sub-session should not announce itself as a separate session.** It should just show the topic. Current behavior emits a `session_joined` service message with a name + SID announcement. For a single-sub-session-at-a-time pattern, the announcement creates the wrong mental model — operator is talking to the coordinator on a topic, not to a separate identity.

2. **Color picker shouldn't fire on sub-session spawn.** The current `session/spawn-child` flow surfaces a color hint and an approval ticket. Operator: "It shouldn't have to select a color." For a parent-with-topic model, the child inherits the parent's color.

3. **Name tag mismatch.** The child's name tag should be identical to the parent's, distinguished only by the topic suffix. Currently a separate name tag appears for the child session. Operator's mental model: parent identity + topic, not parent + child.

4. **Topic should show with a number.** The topic announcement is supposed to include a number suffix (like a Telegram forum topic ID) so operator can route follow-ups by number. Currently no number visible.

## Impact

- The functional path is intact — the sub-session mechanism works end-to-end.
- The UX/announcement bugs are cosmetic-but-mental-model-violating. They don't block the feature working, but they pollute the operator's sense of who they're talking to.

5. **Sub-agent dequeue guidance missing from `spawn_child_subagent_hint` service message.** Operator's mental model: the dispatched sub-agent should default to a long dequeue (~1800s) since it's there to talk to the operator, not to coordinate with the parent. The current `spawn_child_subagent_hint` says "call `dequeue(token: <child>)` continuously" without specifying max_wait. The parent's profile default applies to the parent's own dequeues only; the sub-agent should be told (in the spawn hint) to call `profile/dequeue-default timeout: 1800` early in its lifecycle, or the hint should suggest passing `max_wait: 1800` (with `force: true` if needed). Today the sub-agent reuses whatever default it inherits, which is too short for human-paced interactions.

## Disposition

- Out of scope for the coordinating agent. Route to TMCP queue (`electrified-cortex/Telegram-Bridge-MCP/tasks/`).
- Capture-only here; spec the fix when working on TMCP improvements.
