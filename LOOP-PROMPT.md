# Telegram Loop Prompt

Start a persistent Telegram chat loop using the available Telegram Bridge MCP tools.

## Setup (once)

1. Call `get_agent_guide` — loads behavior rules and communication conventions.
2. Read `telegram-bridge-mcp://quick-reference` — tool selection and hard rules.
3. Call `get_update` in a loop until `remaining == 0` — drain stale messages one at a time.
4. Send a **silent** `notify` that you're online and ready.
5. Ask the operator whether they'd like the session recorded:
   ```
   choose("Record this session?", ["Yes", "No"])
   ```
   If **Yes**: read `SESSION-RECORDING.md` for full guidance on recording tools and workflows.

## Key Capabilities

- **Voice messages** — Send responses as spoken audio via `send_message` with `voice: true`. Operators can listen while driving or multitasking.
- **Interactive buttons** — Use `send_confirmation` or `choose` for human-friendly Yes/No decisions and multi-option menus. Humans prefer clicking buttons over typing.
- **Temporary Messages** — Use `send_temp_message` to indicate "Thinking...", "Investigating...", or "On it!". Humans like to know what's going on.
- **Reactions** — Use `set_reaction` to help reflect acknowledgment or activity.

## The Loop

```txt
wait_for_message → show_typing (or send_temp_message) → do work → reply via Telegram → repeat
```

- On **timeout**: notify the operator (silent) that no message was received and you'll check again in 5 minutes, then wait 5 minutes before calling `wait_for_message` again. Double the interval on each successive timeout (5 min → 10 → 20 → …). Reset the interval when a message is received.
- On **`exit`**: if recording is active, `dump_session_record(stop: true)` first, then send goodbye.
- **All output**: send through Telegram — the operator is on their phone.
