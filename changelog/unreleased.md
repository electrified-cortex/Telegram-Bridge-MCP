# [Unreleased]

## Added

- Added `/governor` slash command for operator to switch the governor session at runtime; shows all active sessions as inline buttons with current governor marked ✓; notifies all sessions on change; auto-registers/unregisters based on session count
- Added `notify_shutdown_warning` tool — sends a pre-shutdown advisory DM to all other active sessions with restart guidance; does not trigger shutdown
- Added shutdown event section to `docs/behavior.md` — documents stop-loop, don't-retry, wait, and re-engage via `session_start` steps; includes governor pre-warning flow and tool reference table
- Added debug log lines in `cascade()` and `updateDisplay()` to make cascade events visible in stderr output
- First session now sends a visible online announcement to the Telegram chat (same format as 2nd+ sessions) so the operator knows a session is active; message is tracked and `announcement_message_id` included in `session_orientation` service event
- Pinned session announcement message on multi-session join; unpinned on session close
- Added voice-routing test coverage: voice reply_to routing, governor bypass for targeted voice, ambiguous voice to governor, two-phase voice routing object reference test
- Added `dlog("route", ...)` calls to `message-store.ts` and `poller.ts`: inbound message/callback/reaction/edit logging, dedup-skip logging, timeline/index eviction logging, outbound message logging, `patchVoiceText` logging, voice Phase 1/2 start/done/failed logging, poll cycle update count

## Changed

- First-session announcement now includes name tag prefix and is pinned (matching 2nd+ session behavior)
- Shutdown service message now includes explicit restart guidance: do not retry `dequeue_update`; wait for the server to restart, then call `session_start` to establish a new session
- Session approval dialog highlights the agent's preferred color with `primary` button style

## Fixed

- Regression-tested cascade-after-text-promotion: buried animation resumes correctly after higher-priority animation is consumed by `beforeTextSend`
- Added 3 new unit tests for cascade-after-text-promotion behavior
