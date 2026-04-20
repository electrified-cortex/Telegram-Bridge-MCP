Session — Manage Telegram agent sessions.

Routes:
- session/start — create new session, get token
- session/reconnect — reclaim session after token loss
- session/list — list all active sessions
- session/close — close current or target session
- session/rename — rename current session
- session/idle — list idle (unresponsive) sessions

action(type: "session") — lists sub-paths in live API.

Token format: sid * 1_000_000 + suffix. Save immediately after session/start or session/reconnect.
First session = governor by default. Second+ require operator approval.

Related: profile/load, shutdown, dequeue
