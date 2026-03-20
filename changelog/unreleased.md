# [Unreleased]

## Added

- Added `/governor` slash command for operator to switch the governor session at runtime; shows all active sessions as inline buttons with current governor marked ✓; notifies all sessions on change; auto-registers/unregisters based on session count
- Added `notify_shutdown_warning` tool — sends a pre-shutdown advisory DM to all other active sessions with restart guidance; does not trigger shutdown
- Added shutdown event section to `docs/behavior.md` — documents stop-loop, don't-retry, wait, and re-engage via `session_start` steps; includes governor pre-warning flow and tool reference table
- Added debug log lines in `cascade()` and `updateDisplay()` to make cascade events visible in stderr output

## Changed

- Shutdown service message now includes explicit restart guidance: do not retry `dequeue_update`; wait for the server to restart, then call `session_start` to establish a new session
- Session approval dialog highlights the agent's preferred color with `primary` button style

## Fixed

- Regression-tested cascade-after-text-promotion: buried animation resumes correctly after higher-priority animation is consumed by `beforeTextSend`
- Added 3 new unit tests for cascade-after-text-promotion behavior
