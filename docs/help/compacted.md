Post-Compaction Recovery (Telegram side)

You just lost conversational context. This help topic covers Telegram/MCP recovery only — your agent harness injects the agent-specific checklist on startup.

1. Your session token is in your memory if previously configured. Read it from there.
2. If token is present: `dequeue(max_wait: 0, token)` to drain pending messages and confirm the bridge link.
3. If token is missing or `dequeue` returns `session_closed`: `action(type: 'session/reconnect', name: '<your_name>')` to rejoin, or `action(type: 'session/start', name: '<your_name>')` for a fresh session.
4. Resume your dequeue loop or last task.

For a richer refresher, call:

- `help('guide')` — full communication/routing protocol
- `help('send')` — message forms (text, voice, hybrid, buttons, checklist, progress)
- `help('reactions')` — reaction priority queue, voice auto-salute, temporary vs permanent
- `help('presence')` — show-typing, animations, presence cascade
- `help('reminders')` — reminder-driven delegation pattern
- `help('identity')` — bot + server version (requires token)
