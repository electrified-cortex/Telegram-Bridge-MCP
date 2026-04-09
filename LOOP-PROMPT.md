# Telegram Loop Prompt

Start a persistent Telegram chat loop using the Telegram Bridge MCP tools.

## Channel Rule

Once the loop is active, Telegram is the conversational surface.
Do not answer substantive operator messages in the VS Code chat panel.
Use VS Code only for tool execution and hidden coordination.
Return to VS Code chat only if the operator explicitly exits the loop or Telegram tools are unavailable.

## Setup

1. Call `help` — read tool descriptions and orient yourself
2. Read `telegram-bridge-mcp://communication-guide`
3. Call `help(topic: "identity")` to verify bot/build identity — if it fails, report the error to the user and stop
4. `session_start` — intro + handles pending messages from previous session
5. **Save your SID and PIN** — write them to your auto-memory directory immediately after `session_start`. After context compaction you will lose in-context state; the saved PIN lets you call `session_start(reconnect: true)` to reclaim your session without operator re-approval.
6. `dequeue` — enter the loop

## Loop

→ receive
→ react (if appropriate)
→ `show_animation` (contextual:thinking)
→ think
→ `show_animation` (contextual:working)
→ work
→ `show_typing` (will cancel animation unless set to persistent)
→ reply/interact
→ `dequeue`

## Canonical Recipe

```text
1. dequeue
2. update arrives → handle it, reply in Telegram
3. timed_out → call dequeue again (stay in loop)
4. error → report in Telegram, then call dequeue again
```

Do not restart, shut down, re-bootstrap, or re-announce the session just because the operator says "resume the loop" or "stay in the loop." That means: call `dequeue` again.

## Instruction Precedence

When rules conflict, follow this order:

1. Active operator instruction
2. Loop-mode Telegram communication rules (this file + `telegram-communication.instructions.md`)
3. Role prompt (Overseer / Worker / custom)
4. General coding-agent defaults
5. Memory notes — advisory only, not authoritative

If memory conflicts with live tool state or current operator instruction, memory loses.

## Visible Presence

Use `show_animation` as the default "I am thinking / working" signal.
Use `send_new_progress` only when you intend to update the same progress message over time.
Use `send_new_checklist` only for real multi-step tracked workflows.
Do not create progress or checklist artifacts for one-shot status signaling.

## Recovery After Context Compaction

When your context is compacted (prior messages compressed), you may lose your SID and PIN:

1. Check your auto-memory directory for saved credentials
2. Call `session_start(name: "<your name>", reconnect: true)` with the same session name
3. Call `get_chat_history` to catch up on missed messages
4. Resume the `dequeue` loop

Do **not** call a fresh `session_start` if you can reconnect — it wastes operator approval and creates a duplicate session announcement.

## Common Failure Modes

- Replying in VS Code chat while the loop is active
- Restarting/recovering the session when a simple `dequeue` call would suffice
- Trusting stale memory over live tool state (stored SID/PIN, old test counts, outdated board state)
- Using progress/checklist tools for presence instead of `show_animation`
- Deleting or mass-editing user-visible messages without explicit approval
