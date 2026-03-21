# Task #046 — Clean Up Stale Session Pins on Startup

## Completion

**Date:** 2026-03-20

### Files Modified
- `src/startup-pin-cleanup.ts` — new module with `cleanupStalePins()` function
- `src/startup-pin-cleanup.test.ts` — new test file (9 tests)
- `src/index.ts` — import and call `cleanupStalePins()` after poller starts, before "Online" notification
- `changelog/unreleased.md` — Added entry

### Summary
Implemented `cleanupStalePins()` in a dedicated module. On startup it loops: calls `getChat` to get the most recently pinned message, checks if it's a bot-sent session announcement (`from.is_bot === true` + text matches `Session \d+ — 🟢 Online`), unpins it, and repeats until no stale pins remain or a non-bot pin is encountered. Fully best-effort — all errors are swallowed.

### Tests
- 9 new tests (happy path, multi-pin loop, operator pin left alone, non-matching bot pin left alone, error swallowing)
- Total: 1654 tests, all passing

### Build
PASS

---

## Context

When the server crashes (no graceful shutdown), session announcement messages remain pinned in the Telegram chat. On restart, there's no cleanup — new sessions start fresh, leaving stale pins that confuse the operator.

The graceful shutdown path (`elegantShutdown` in `shutdown.ts`) already unpins all announcement messages. But a crash bypasses this entirely.

## Objective

On server startup, before accepting any `session_start` calls, scan for and unpin any stale session announcement messages from a previous run.

## Approach

1. **In `src/index.ts`**, after the poller starts and before the "Online" notification, add a startup cleanup step:

   - Call `getApi().getChat(chatId)` — the response includes `pinned_message` (the most recently pinned message)
   - Check if the pinned message matches the session announcement pattern (e.g., starts with "📢" or matches the format used by `session_start`)
   - If it matches, unpin it
   - Note: `getChat` only returns the *most recent* pinned message. For multiple stale pins, we may need `unpinAllChatMessages` (nuclear option) or scan recent bot messages

2. **Alternative approach**: Track announcement message IDs persistently (e.g., in a file or via bot message history). On startup, attempt to unpin any previously known IDs. This is more reliable but requires persistence.

3. **Simplest approach**: Use `getChatHistory` to find recent bot messages matching the announcement pattern, then unpin them. This doesn't require persistence but is more API-intensive.

## Implementation Notes

- Session announcements are sent by `session_start` tool — check the format there
- `unpinChatMessage` on an already-unpinned message returns an error, but we already `.catch(() => {})` these calls
- This should run as best-effort — don't block startup if it fails
- Consider making this configurable (env var or config option) in case the operator pins messages manually

## Acceptance Criteria

- [ ] On startup, stale session announcement pins are cleaned up before any new sessions start
- [ ] Graceful degradation — errors during cleanup don't block the server
- [ ] No false positives — only unpin messages that match the session announcement pattern
- [ ] Tested (at minimum: unit test showing cleanup runs on startup)
