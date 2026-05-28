---
name: telegram-mcp-dump-handling
description: >-
  Procedure for filing Telegram session dumps. Use when a `action(type: "log/dump")`
  document arrives in the chat or when checking for unfiled dumps during
  periodic maintenance.
compatibility: "Requires Telegram MCP bridge"
---

# Telegram MCP Dump Handling

Session dumps capture conversation history as JSON documents. They must be
filed promptly so no conversation data is lost between sessions.

## Reaction Protocol

Use two-step reactions on dump messages for visual progress feedback:

1. **✍** (pencil) — set immediately when you begin processing
2. **🫡** (salute) — set when fully filed (replaces ✍)

## Inline (Reactive) Filing

When a dump document event appears in `dequeue` (see **telegram-mcp-dequeue-loop**):

1. React ✍ on the dump message.
2. `action(type: "download", file_id: <id>)` — returns document bytes.
3. Save to an archive subdirectory keyed by date+time (e.g. `logs/telegram/YYYYMM/DD/HHmmss/dump.json`) using the dump's
   timestamp (real seconds, not message ID).
4. Stage and commit: `git add logs/telegram/<path>` then commit with
   `docs: file telegram dump YYYY-MM-DD`.
5. React 🫡 on the dump message (replaces ✍).

This is pre-approved — non-destructive, no confirmation needed.

## Periodic (Proactive) Filing

On the recurring dump-check reminder:

1. List `logs/telegram/` to find the most recent filed dump.
2. `get_chat_history` and scan for document messages newer than the last
   filed dump.
3. Download and file any unfiled dumps (with ✍ → 🫡 reactions on each).
4. Stage and commit all new dumps in a single commit:
   `docs: file N telegram dumps from YYYY-MM-DD`.

This catches dumps that arrived while the agent was dead, compacted, or
otherwise missed the event.

## File Path Convention

Save under the workspace's archive convention: an archive subdirectory keyed by date+time within `logs/telegram/`.

Use the dump's creation timestamp, not the current time.
