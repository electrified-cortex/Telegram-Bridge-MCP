Session — Manage Telegram agent sessions.

Routes:
- session/start — create new session, get token
- session/reconnect — reclaim session after token loss
- session/list — list all active sessions
- session/close — close current or target session
- session/rename — rename current session
- session/idle — list idle (unresponsive) sessions

action(type: "session") — lists sub-paths in live API.

Token: opaque integer. Save immediately after session/start or session/reconnect.
First session = governor by default. Second+ require operator approval.

## Activity File Cleanup on session/close

When a session is closed (via session/close or force-close during shutdown), TMCP automatically deletes the session's TMCP-owned activity file from `data/activity/`. This triggers any file-watching agent (using the file-watching skill) to emit `gone` and exit cleanly. Agent-supplied activity file paths (registered via activity/file/create with an explicit path) are unregistered but not deleted — the agent owns those files' lifecycle.

Related: profile/load, shutdown, dequeue
