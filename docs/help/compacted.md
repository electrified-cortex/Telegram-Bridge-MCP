Post-Compaction Recovery (Telegram side)

You just lost conversational context. This help topic covers Telegram/MCP recovery only — your agent harness injects the agent-specific checklist on startup.

1. **Session token**: read it from your memory file if previously saved.
2. **If token present**: `dequeue(max_wait: 0, token)` to drain pending messages and confirm the bridge link.
3. **If token missing or `dequeue` returns `session_closed`**: call `action(type: 'session/reconnect', name: '<your_name>')` to rejoin, or `action(type: 'session/start', name: '<your_name>')` for a fresh session.
4. **Monitor (if you were using one)**: check your harness's task list for a monitor named "Telegram message notifier". If it's active, you're set — TMCP keeps your registered activity file intact across compaction; only the monitor task might have been lost. If the monitor is gone, call `action(type: 'activity/file/get')` for the registered path, then arm a fresh **persistent** monitor with the description "Telegram message notifier" (see `help('activity/file')`). If `activity/file/get` returns nothing, call `action(type: 'activity/file/create', refresh: true)` for a clean reset.
5. **Resume your dequeue loop**.

For a richer refresher:

- `help('guide')` — full communication/routing protocol
- `help('send')` — message forms (text, voice, hybrid, buttons, checklist, progress)
- `help('reactions')` — reaction priority queue, voice auto-salute, temporary vs permanent
- `help('presence')` — show-typing, animations, presence cascade
- `help('reminders')` — reminder-driven delegation pattern
- `help('activity/file')` — activity-file kick mechanism, monitor invocation, refresh flag
- `help('identity')` — bot + server version (requires token)
