---
name: telegram-mcp-dequeue-loop
description: >-
  The main event loop pattern for Telegram bridge MCP agents. Use when
  implementing or reviewing the dequeue loop that keeps an agent
  responsive and alive in the Telegram chat.
compatibility: "Requires Telegram MCP bridge"
---

# Telegram MCP Dequeue Loop

The dequeue loop is the heartbeat of every Telegram-enabled agent. It ensures
the agent stays responsive, processes events, and never silently exits.

## The Invariant

**Every code path ends with `dequeue`.** No exceptions. There is no
"I'm done" state. The loop runs until a shutdown signal is received.

## Flow

```text
dequeue
  ↓
messages?  → handle message  → dequeue
  ↓
timeout    → scan for work   → dequeue
  ↓
reminder   → handle reminder → dequeue
  ↓
error      → notify superior → dequeue
```

## Rules

1. **Drain before acting.** If `pending` is non-zero, call `dequeue`
   again to get all queued messages before starting work.

2. **Stay responsive.** Call `dequeue()` between work chunks. Long
   tasks should be broken into steps with a dequeue between each.

3. **After subagent returns:** review the result, DM your superior, then
   `dequeue` — do NOT stop.

4. **After an error:** notify your superior (Curator, Overseer, or operator),
   then `dequeue` — do NOT stop.

5. **Default timeout.** Always use the default timeout on `dequeue`.
   The only exception is `timeout: 0` when draining pending messages after
   reconnect or when probing.

6. **Never assume silence means approval.** The operator may be busy. Wait
   for explicit responses.

## Before Exiting

If you ever feel like you should stop, DM your superior first:
*"Do you still need me?"* Only a direct shutdown signal triggers
`action(type: "session/close")`. See **telegram-mcp-graceful-shutdown** for the full
shutdown procedure.

## Reactions

- **Dequeued voice messages are already saluted.** The bridge auto-applies 🫡
  to voice messages when they are dequeued (after transcription completes).
  Do not re-salute them — it wastes tokens for no effect. Regular text
  messages are NOT auto-saluted.
- **The 👀 → 🫡 pattern is encouraged.** When processing a message, set 👀
  (eyes) to signal you're reviewing it, then set 🫡 when done. This gives the
  operator visual feedback that you're actively working on their message.
- **Saluting non-voice messages is optional.** Reactions are welcome when
  they're relevant — not required. Don't force reactions for the sake of it.
  Just be aware that dequeued voice messages already carry the salute.

## Messaging Guidelines

- **Voice by default.** Use `send(type: "text", audio: "...")` for conversational replies.
  Use `send(type: "text", ...)` for structured content (tables, code, lists).
- **`send(type: "question", confirm: "...")`** for yes/no decisions. **`send(type: "question", choose: [...])`** for multi-option.
- **Watch `pending`.** Non-zero means the operator sent more — drain first.
- **Announce before major actions.** Use `send(type: "question", confirm: "...")` for destructive ones.
- **Async waits.** Use `send(type: "animation", persistent: true)` + `dequeue`
  loop. Check in proactively.

## Compact Mode

Pass `response_format: "compact"` to each `dequeue` call to save ~445 tokens per session.
Adapting the loop is straightforward:

- **Infer empty from absence of `updates`** — `empty: true` is suppressed in compact mode.
  Check `!result.updates` instead of `result.empty`.
- **`timed_out: true` is always emitted** — no change needed for the timeout branch.

```text
Default:  if (result.empty)    → empty
          if (result.timed_out) → timeout
          else                  → process result.updates

Compact:  if (!result.updates)  → empty (no updates key = empty poll)
          if (result.timed_out) → timeout (always present)
          else                  → process result.updates
```

Migrate each agent independently by adding `response_format: "compact"` to its `dequeue`
calls. No other loop logic changes are required.

## Idle Behavior

No tasks does not equal done. When idle: `dequeue` silently. On
timeout, scan for available work, then `dequeue` again. No animations
when idle — silence is the correct signal that nothing requires attention.
