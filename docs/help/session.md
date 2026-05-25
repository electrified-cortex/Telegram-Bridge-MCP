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

## Auto-load profiles on session/start

Pass `autoload_profile: true` to `session/start` to automatically apply the saved profile that matches the session name (if one exists). No error if no profile is found — session starts normally.

Profile-level opt-in: if a profile was saved with `autoload: true` (via `profile/save`), it auto-applies whenever a session with that name starts, regardless of `autoload_profile`.

Conflict resolution: `autoload_profile: false` + profile `autoload: true` → profile wins.

`session/reconnect` never auto-loads.

## Activity File Cleanup on session/close

When a session is closed (via session/close or force-close during shutdown), TMCP automatically deletes the session's TMCP-owned activity file from `data/activity/`. This triggers any file-watching agent (using the file-watching skill) to emit `gone` and exit cleanly. Agent-supplied activity file paths (registered via activity/file/create with an explicit path) are unregistered but not deleted — the agent owns those files' lifecycle.

Related: profile/load, shutdown, dequeue
