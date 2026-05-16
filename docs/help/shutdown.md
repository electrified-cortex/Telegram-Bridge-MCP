Graceful Shutdown — how to exit the Telegram bridge cleanly.

Only the **governor** (Curator) may call action(type: "shutdown"). Participants call action(type: "session/close") on their own session only.

## Participant Shutdown

When the governor DMs you "Shutting down — close your session" (or you decide to close early):

1. Wipe your session token. Overwrite `memory/telegram/session.token` with empty content. Prevents stale-token resume on next launch.
2. action(type: "session/close") — closes YOUR session only. Never pass target_sid.
3. Stop. No more tool calls after session/close.
4. Optional: write a handoff doc and commit. Your agent process is still alive after session/close; you can still write files and commit. Token is already wiped so you are no longer connected to the bridge.

## Governor Shutdown

Only Curator executes this flow. action(type: "shutdown") is the governor's analogue of session/close — it tears down the whole bridge, including the governor's own session. Do NOT call session/close on yourself before shutdown.

1. Drain queue. dequeue(max_wait: 0) until empty.
2. Generate compaction report (failure-tolerant). Run `node scripts/event-report.mjs --format text` from repo root and save stdout to `logs/session/YYYYMM/DD/HHmmss/compaction-report.md` (use the same timestamp directory as the session log; create it now if it doesn't exist). Pass `--window <session-hours>` if the session ran longer than 24 h. If the script is absent, the event log is missing, or the run fails, note it in the session summary and skip — this step MUST NOT block shutdown.
3. Wipe session memory file. Overwrite `memory/telegram/session.token` with empty content before calling shutdown.
4. DM each remaining session: "Shutting down — close your session."
5. Wait for session_closed events from each participant.
6. Write session log: logs/session/YYYYMM/DD/HHmmss/summary.md. If the compaction report was generated, note it (e.g., `Compaction report: see compaction-report.md`).
7. Commit: git add session log + compaction report (if generated) + any pending changes.
8. Acknowledge operator (brief voice message).
9. action(type: "shutdown") — triggers MCP bridge graceful shutdown. This is the last action you take; it closes your session and shuts down the bridge. Do NOT call session/close on yourself before this.

Invariant: wipe token BEFORE calling shutdown.
Note: handoff doc is optional. It may be written before or after shutdown — your process continues running. Curator's habit of writing it before shutdown is a preference, not a TMCP requirement.

If a participant fails to close cleanly, the governor may need action(type: "session/close", force: true, target_sid: N) before invoking shutdown.

## Activity File Cleanup

TMCP automatically deletes all TMCP-owned activity files (`data/activity/<hash>`) on shutdown. This applies to:
- action(type: "shutdown") — MCP graceful shutdown
- OS SIGTERM / SIGINT — process-level shutdown

If you registered an activity file that TMCP created for you (via activity/file/create with no path), it will be gone when shutdown completes. File-watching agents (using the file-watching skill) receive a `gone` event and exit cleanly. No manual cleanup is required.
