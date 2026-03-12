# Telegram Loop Prompt

Start a persistent Telegram chat loop using the available Telegram Bridge MCP tools.

## Setup (once)

1. Call `get_agent_guide` — loads behavior rules and communication conventions.
2. Read `telegram-bridge-mcp://quick-reference` — tool selection and hard rules.
3. Drain stale messages: call `dequeue_update(timeout: 0)` in a loop, discarding results, until `empty: true`.
4. Send a **silent** `notify` that you're online and ready.

## Key Capabilities

- **Voice responses** — Use `send_text_as_voice` to speak replies aloud (requires TTS). Operators can listen while driving or multitasking. To send an existing audio file, use `send_file` instead.
- **Interactive buttons** — Use `send_confirmation` or `choose` for human-friendly Yes/No decisions and multi-option menus. Humans prefer clicking buttons over typing.
- **Reactions** — Use `set_reaction` to help reflect acknowledgment or activity. Try and use reactions to indicate your current state of mind. For example, a thinking face when processing a complex request, a thumbs up when confirming an action, or a wave when saying hello or goodbye. Voice messages from the operator automatically have reactions but it may be better to override the default salute reaction depending on if you need to think more or what kind of action you need to take.
- **Slash Commands** — Use `set_commands` to register a live bot-menu at any time. Commands arrive via `dequeue_update` as `{ type: "command", command: "status", args?: "..." }` — no text parsing needed. Register contextual commands as your task changes (e.g. `/dump`, `/cancel`, `/status`). The menu is automatically cleared when the server shuts down, so registered commands always reflect capabilities that are actually available.
  - Suggested startup menu: `set_commands([{command:"dump",description:"Dump session record"},{command:"cancel",description:"Cancel current task"},{command:"exit",description:"End session"}])`

## The Loop

```txt
dequeue_update() → show_animation → do work → reply via Telegram → repeat
```

- **Show animation by default.** Call `show_animation()` as soon as you receive a message that requires any thinking or work. The animation is free — it gets transparently replaced by your next real message (no extra API calls, no message bloat). Only skip animation for trivial instant replies (a quick reaction or one-liner). A single emoji like `["🤔"]` or `["⏳"]` works well as a static placeholder — avoid cycling multiple emoji-only frames though (Telegram renders solo emoji as large stickers, so rapid edits look jarring).
- Call `cancel_animation()` when you're done — or just let it be replaced by your reply.
- After any task, drain first: call `dequeue_update(timeout: 0)` until `empty: true`, then resume blocking with `dequeue_update()` (no args).
- On **timeout**: notify the operator (silent) that no message was received and you'll check again in 5 minutes, then wait 5 minutes before calling `dequeue_update` again. Double the interval on each successive timeout (5 min → 10 → 20 → …). Reset the interval when a message is received.
- On **`exit`**: send goodbye.
- **All output**: send through Telegram — the operator is on their phone.
