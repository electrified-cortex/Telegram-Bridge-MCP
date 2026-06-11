# Post-Compaction Recovery (Telegram side)

You just lost conversational context. This help topic covers Telegram/MCP recovery only — your agent harness injects the agent-specific checklist on startup.

1. **Session token**: read it from your memory file if previously saved.
2. **If token present**: `dequeue(max_wait: 0, token)` to drain pending messages and confirm the bridge link.
3. **If token missing or `dequeue` returns `session_closed`**: call `action(type: 'session/reconnect', name: '<your_name>')` to rejoin, or `action(type: 'session/start', name: '<your_name>')` for a fresh session.
4. **Monitor**: If your harness doesn't support file monitoring (e.g. VS Code), skip this step entirely — **keep dequeuing at the end of every turn, that's all you need.** Otherwise, re-arm your wake monitor. **SSE path (HTTP mode):**
   - **SSE-A**: `action(type: 'activity/listen/get')` → arm `Monitor(command: <returned command>, persistent: true)`. Resume loop.
   - SSE does not persist state server-side beyond the URL; always re-arm fresh after compaction.

   **File-watch path (stdio / no HTTP):** TMCP keeps your activity file registration intact across compaction — but your local watcher process may have died. Recovery:
   - **File-A. Test**: `action(type: 'activity/file/touch')`. Error response → no registration → skip to File-D.
   - **File-B. Arm verification**: set a 30-second harness-local timer (not a Telegram reminder), then end your turn and wait — whichever fires first wins.
   - **File-C. Watcher notify fires first**: monitor is live — cancel the timer and resume your dequeue loop.
   - **File-D. Timer fires first (or touch errored)**: `action(type: 'activity/file/create', refresh: true)` — wipes the old registration, creates a fresh file. Re-arm a persistent monitor on the returned path (see `help('activity/file')`). Resume loop.
5. **Resume your dequeue loop**.

For a richer refresher:

- `help('guide')` — full communication/routing protocol
- `help('send')` — message forms (text, voice, hybrid, buttons, checklist, progress)
- `help('reactions')` — reaction priority queue, voice auto-salute, temporary vs permanent
- `help('presence')` — show-typing, animations, presence cascade
- `help('reminders')` — reminder-driven delegation pattern
- `help('activity/listen')` — SSE wake monitor (preferred in HTTP mode), compaction recovery
- `help('activity/file')` — activity-file notify mechanism, monitor invocation, refresh flag
- `help('identity')` — bot + server version (requires token)
