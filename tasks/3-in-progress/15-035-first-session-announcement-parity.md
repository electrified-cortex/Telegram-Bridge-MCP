# Task 035 — First-Session Announcement Parity

**Priority:** 15 (high)
**Branch:** `task/035-first-session-announcement`

## Problem

The first session's "Session N — 🟢 Online" announcement is missing two things that 2nd+ sessions get:

1. **No name tag prefix** — `buildHeader()` in `outbound-proxy.ts` returns empty when `activeSessionCount() < 2`, so the outbound proxy never prepends "🟦 🤖 Overseer\n". Second+ sessions get the tag because the proxy sees 2+ active sessions.
2. **No pin** — The first-session branch in `session_start.ts` (line 203–221) calls `trackMessageOwner` but skips `setSessionAnnouncementMessage` and `pinChatMessage`. The 2nd+ branch (line 222–246) does both.

As a result, the first session announcement appears as a bare "Session 1 — 🟢 Online" with no attribution and no pin. The operator expects consistent behavior regardless of session count.

## Requirements

1. The first-session announcement text must include the session name and color, matching the format a 2nd+ session would produce. Since `buildHeader` intentionally skips single-session mode to avoid tagging every outbound message, the announcement should manually compose the header inline:
   - Format: `{color} 🤖 {name}\nSession {sid} — 🟢 Online`
   - Example: `🟦 🤖 Overseer\nSession 1 — 🟢 Online`
2. The first-session announcement must be pinned (`pinChatMessage` with `disable_notification: true`).
3. The first-session announcement must be tracked via `setSessionAnnouncementMessage` so `close_session` can unpin it.
4. Do NOT modify `buildHeader` — the single-session skip is intentional for regular outbound messages.
5. The `session_start.test.ts` already has tests for first-session announcement. Update them to assert:
   - The sent text includes the session name (not just "Session N — 🟢 Online")
   - `pinChatMessage` is called
   - `setSessionAnnouncementMessage` is called

## Files to Change

| File | Change |
|---|---|
| `src/tools/session_start.ts` | Lines 206–221: compose header inline, add pin + setSessionAnnouncementMessage |
| `src/tools/session_start.test.ts` | Update first-session announcement tests to assert name tag, pin, and tracking |

## Source References

- `src/outbound-proxy.ts:33` — `if (activeSessionCount() < 2) return { plain: "", formatted: "" };`
- `src/tools/session_start.ts:203–221` — first-session announcement (no pin, no setSessionAnnouncementMessage)
- `src/tools/session_start.ts:230–246` — 2nd+ session announcement (has pin + tracking)
- `src/tools/close_session.ts:53–58` — unpin logic depends on `getSessionAnnouncementMessage`
- `src/tools/session_start.test.ts:682–726` — existing first-session announcement tests

## Changelog

```
### Changed
- First-session announcement now includes name tag prefix and is pinned (matching 2nd+ session behavior)
```
