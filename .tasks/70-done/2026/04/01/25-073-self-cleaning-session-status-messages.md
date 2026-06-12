# Task: Self-Cleaning Session Status Messages

**Created:** 2026-04-01
**Status:** queued
**GitHub Issue:** #103

## Objective

Auto-delete transient session status messages (unresponsive / back-online) so they
don't accumulate in the chat.

## Context

When a session becomes unresponsive and later recovers, the service messages pile up.
The proposed lifecycle:

1. Session goes unresponsive → post warning message.
2. Session recovers → delete the warning, post "back online."
3. Session sends first real message → delete the "back online" (redundant now).

Net result: at any moment, only the current state is visible. Active sessions have
zero leftover status messages.

## Acceptance Criteria

1. Bridge tracks `message_id` of "unresponsive" service message per session.
2. On recovery, deletes unresponsive message and posts "back online."
3. On first real `send_*` from recovered session, deletes "back online" message.
4. No orphaned status messages in normal operation.

## Notes

- See GitHub issue #103 for full spec.
- Requires bridge-level changes (session lifecycle tracking).
- Worker must use a worktree for this implementation.

## Completion

**Status:** complete
**Date:** 2026-04-01
**Worker:** Worker 2

Changed files:
- `src/telegram.ts` — `sendServiceMessage` now returns `Promise<number | undefined>` (the message_id)
- `src/outbound-proxy.ts` — added `registerOnceOnSend` / `clearOnceOnSend` / `fireSendNotifier`; fires on every real outbound send (text, file, animation-intercepted path)
- `src/health-check.ts` — tracks `_unresponsiveMsgIds` and `_backOnlineMsgIds` per session; deletes warning on recovery, registers one-shot hook to delete back-online on first real send; cleanup in `stopHealthCheck`
- `src/health-check.test.ts` — 7 new tests covering the full self-cleaning lifecycle

All 1766 tests pass. Typecheck clean.
