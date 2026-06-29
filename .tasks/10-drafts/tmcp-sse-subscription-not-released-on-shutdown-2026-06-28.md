# Defect: SSE activity subscription not released on bridge shutdown

**Reported:** 2026-06-28
**Reporter:** Ops (observed during deliberate TMCP version bump on bt-bridge)
**Severity:** Low / UX

## Description

When the TMCP bridge shuts down (deliberate or otherwise), active SSE activity subscriptions
(established via `activity/listen`, consumed by `sse-monitor.sh`) are not gracefully released.
The client receives a raw connection error instead of a proper close event.

**Expected:** Bridge emits a graceful close/cancel event (e.g. `data: {"type":"service","event":"cancelled"}`)
to all active SSE activity subscribers before shutdown, allowing clients to cleanly terminate.

**Actual:** Connection drops abruptly → client receives a connection refused / EOF error.
`sse-monitor.sh` exits with code 255 (SSH/connection failure), leaving the monitoring loop
in an unclean state that requires manual TaskStop + restart.

## Steps to reproduce

1. Arm `sse-monitor.sh` against `activity/listen` SSE stream (persistent Monitor task).
2. Stop or restart the TMCP bridge process.
3. Observe: monitor exits with `exit 255` (connection error) rather than a clean `closed` event.

## Impact

- Monitoring agent must manually detect the drop (via failed dequeue), TaskStop the monitor,
  and re-arm it after the bridge comes back up.
- If the agent doesn't notice promptly, Telegram messages are missed during the window.

## Notes

- `session/close` already handles `activity/file/delete + activity/listen/cancel` for clean
  operator-initiated session teardown. The gap is bridge-process-level shutdown (SIGTERM/SIGKILL),
  which bypasses the session-close path.
- Possible fix: register a process shutdown hook that drains and closes all active SSE streams
  before the HTTP server stops accepting connections.
