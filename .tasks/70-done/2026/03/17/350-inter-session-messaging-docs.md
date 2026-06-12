# Docs: Inter-Session Messaging & Agent Instruction Templates

## Type

Documentation

## Priority

350

## Description

Two inter-session tools exist — `route_message` and `send_direct_message` — but there is no behavioral documentation telling agents when or how to use them. Agents encountering these tools have no guidance. Additionally, there are no prompt templates for governor or worker behavior in multi-session scenarios.

## Current State

The tools exist and work:

- **`route_message(sid, pin, message_id, target_sid)`** — Re-deliver an existing message from your queue to another session's queue. Governor uses this to dispatch ambiguous messages to the right worker.
- **`send_direct_message(sid, pin, target_sid, text)`** — Send a new text-only message directly to another session's queue. Used for inter-agent coordination (behind the scenes, not visible to operator).

But `docs/behavior.md` and `docs/communication.md` have no usage guidance for these tools, and there are no prompt templates for multi-session agents.

## What to Document

### In `docs/behavior.md`

Under a "Inter-Session Communication" section:

1. **`route_message`** — When: you're the governor and an ambiguous message isn't for you. How: check `list_sessions()` for available workers, forward to the best match. The target session sees the original message as-is.
2. **`send_direct_message`** — When: you need to coordinate with another session (e.g., "I'm done with the database, you can start your migration"). The target sees it as an internal event, not a user message.
3. **Etiquette** — Don't spam other sessions. Don't route messages you should handle. Governor routes, workers handle.

### In `docs/communication.md`

Add to the tool selection table:

| Situation | Tool |
| --- | --- |
| Forward user message to another session | `route_message` |
| Send internal note to another session | `send_direct_message` |

### Agent Instruction Templates

Create `docs/multi-session-prompts.md` with prompt snippets for:

1. **Governor role** — "You receive all new (ambiguous) messages from the operator. Decide if it's for you or delegate via `route_message` / `send_direct_message`. If unsure which worker should handle it, ask the user with `choose` buttons listing the session names. Set a topic reflecting your coordinating role."
2. **Worker role** — "You only receive messages that are specifically for you (reply-to, callback, or routed by the governor). Focus on your assigned topic. Use `send_direct_message` to report back to the governor when done. Set a topic reflecting your current work."
3. **Topic discipline** — "Always set a topic on join. Update it as your focus changes. The topic helps the operator and governor route work effectively."

## Acceptance Criteria

- [ ] `docs/behavior.md` documents `route_message` and `send_direct_message` with when/how/why
- [ ] `docs/communication.md` tool selection table includes inter-session tools
- [ ] `docs/multi-session-prompts.md` created with governor and worker prompt templates
- [ ] Examples for each tool usage scenario
- [ ] Changelog updated
- [ ] No markdown lint errors
