# Task #038: Graceful Shutdown — Close All Sessions Before Exit

**Priority:** 25 | **Status:** Draft

## Problem

When `shutdown` is called, active sessions are terminated abruptly without calling `close_session`. This means their pinned announcement messages are never unpinned, leaving stale pins in the chat after restart.

Additionally, sessions do not get a chance to wrap up (send farewell broadcast, unpin, etc.) before the process exits.

## Goal

When `shutdown` is called, the server closes all active sessions gracefully before exiting. Each session runs its normal close logic (unpinning its announcement, broadcasting `session_closed`), resulting in a clean state prior to process exit.

## Background

Task #037 (unpin on close_session) is a prerequisite — once close_session handles unpinning, chaining it from shutdown gets the cleanup for free.

## Scope

### `src/tools/shutdown.ts` (or equivalent shutdown handler)

Before triggering process exit:

1. Enumerate all active sessions
2. For each session, invoke the same close logic used by `close_session` — broadcast `session_closed`, unpin announcement, clean up session state
3. After all sessions are closed, proceed with the process shutdown

**Note:** This must be fire-and-settle — don't let a single session's close error block the shutdown. Use `Promise.allSettled` or equivalent.

**Note:** The server may not have time for full async round-trips on a forced shutdown signal (SIGTERM). Document whether this applies to the graceful-shutdown tool path vs. OS signal path, and handle appropriately.

### Tests

- Add test: shutdown with active sessions triggers close logic for each
- Add test: close errors for one session do not prevent shutdown from completing

## Acceptance Criteria

- After shutdown, all previously active session announcements are unpinned
- No stale `session_closed` broadcasts are missed
- Shutdown still completes even if one session's close fails
- Existing shutdown behavior (shutdown service event, process exit) unchanged

## Dependencies

- Task #037 (unpin on close_session) should be completed first
