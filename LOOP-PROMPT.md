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
4. `action(type: "session/start")` — intro + handles pending messages from previous session
5. **Save your SID and PIN** — write them to your auto-memory directory immediately after `action(type: "session/start")`. After context compaction you will lose in-context state; the saved PIN lets you call `action(type: "session/reconnect", name: "<your name>")` to reclaim your session without operator re-approval.
5b. **Subscribe to your inbox channel** — subscribe to `telegram://inbox/<token>` (use the integer token from step 4) via MCP resource subscriptions. TMCP will push `notifications/resources/updated` when messages arrive and will cap your `max_wait` to 90 s automatically. If your MCP client does not support resource subscriptions, call `activity/file/create` instead.
6. `dequeue` — enter the loop

## Loop

→ receive
→ react (if appropriate)
→ `send(type: "animation")` — thinking context
→ think
→ `send(type: "animation")` — working context
→ work
→ `action(type: "show-typing")` (will cancel animation unless set to persistent)
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

Use `send(type: "animation")` as the default "I am thinking / working" signal.
Use `send(type: "progress")` only when you intend to update the same progress message over time.
Use `send(type: "checklist")` only for real multi-step tracked workflows.
Do not create progress or checklist artifacts for one-shot status signaling.

## Recovery After Context Compaction

When your context is compacted (prior messages compressed), you may lose your SID and PIN:

1. Check your auto-memory directory for saved credentials
2. Call `action(type: "session/reconnect", name: "<your name>")` with the same session name
3. Call `action(type: "history/chat", count: ...)` to catch up on missed messages
4. Resume the `dequeue` loop

Do **not** call a fresh `action(type: "session/start")` if you can reconnect — it wastes operator approval and creates a duplicate session announcement.

## Sub-sessions (Spawning a Child Session)

When a topic warrants an isolated scope, spawn a child session and hand it to a
background sub-agent:

**Initiation sequence:**

1. `action(type: 'session/spawn-child', token: <your_token>, topic: '<topic label>')`
   → returns `{ token: <child_token>, sid: <child_sid>, ... }`
2. **Immediately** call `action(type: 'child/forward', token: <your_token>, child_sid: <child_sid>, message: '<task brief>')` — this is the `forward-child` step and is REQUIRED before the child's first dequeue. Without it the sub-agent dequeues with no context.
3. Launch a background sub-agent with `<child_token>`; its loop is `dequeue(token: <child_token>)`.

**Host duties while the child is live:**

- Route relevant operator messages to the child via `child/forward`.
- Watch for `child_session_resolved` in your own dequeue; check `exit_status`.
- If the sub-session goes silent, revoke it: `action(type: 'session/revoke-child', token: <your_token>, child_token: <child_token>)`.

Call `help(topic: 'sub-sessions')` for the full reference.

## Common Failure Modes

- Replying in VS Code chat while the loop is active
- Restarting/recovering the session when a simple `dequeue` call would suffice
- Trusting stale memory over live tool state (stored SID/PIN, old test counts, outdated board state)
- Using progress/checklist tools for presence instead of `send(type: "animation")`
- Deleting or mass-editing user-visible messages without explicit approval
- Spawning a child session without calling `child/forward` first — the sub-agent arrives blind
