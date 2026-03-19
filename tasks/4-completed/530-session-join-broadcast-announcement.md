# 530 — Session join broadcast announcement

**Priority:** 250 (Medium-High)
**Scope:** `src/tools/session_start.ts`, `src/session-queue.ts`, `src/outbound-proxy.ts`

## Problem

When a session is approved, the approval prompt is private to the operator and gets edited in-place. No visible announcement is sent to the chat, and other sessions only receive internal service messages. There's no way for the operator (or other sessions) to reply-to-address the new session.

## Requirements

1. After approval, **delete** the approval prompt message (it's private UI, not public)
2. **Send a visible broadcast message** through the existing outbound proxy `sendMessage` wrapper (which adds name tags automatically when multi-session is active — do NOT build the header independently). Ensure the ALS session context is set to the approved session's SID before sending so the outbound proxy renders the correct name tag. The body text is "Session N — 🟢 Online". The outbound proxy will prepend the name tag header, producing:
   ```
   🟨 🤖 Worker 1
   Session 2 — 🟢 Online
   ```
3. **Track the announcement as owned by the approved session** so that replying to it routes to that session (`trackMessageOwner(msgId, sid)`)
4. **Deliver a service event to all session queues** so every session knows someone joined (existing `deliverServiceMessage` behavior, but now with the broadcast message_id attached)
5. Any session or the operator can **reply to the announcement** to address the new session directly — existing `resolveTargetSession` handles this via `getMessageOwner`

## Completion

**Status:** Done — 1485/1485 tests pass, build clean.

**Implementation:**
- `requestApproval()` in `session_start.ts`: on approval, calls `deleteMessage(chatId, msgId)` instead of editing to "approved" text; on denial keeps `editMessageText` for the denial outcome
- After `createSession` + `createSessionQueue` + `setActiveSession`, when `sessionsActive > 1`: sends `"Session N — 🟢 Online"` via `Promise.resolve(runInSessionContext(session.sid, () => getApi().sendMessage(...)))` so the outbound proxy prepends the correct name tag
- Calls `trackMessageOwner(announcementMsgId, session.sid)` so reply-to routing reaches this session
- Includes `announcement_message_id` in `session_joined` and `session_orientation` `deliverServiceMessage` details
- Key bug fixed during implementation: `runInSessionContext` is synchronous; calling `.catch()` directly on its result throws when `sendMessage` returns a non-Promise (e.g. in tests). Wrapped with `Promise.resolve()` first.

**Test changes in `session_start.test.ts`:**
- Added `deleteMessage` and `trackMessageOwner` to hoisted mocks + mock factories
- Replaced "post-decision edit shows color + name after approval" with 3 new tests:
  1. "approval prompt deleted (not edited) after operator approves"
  2. "broadcasts online announcement after approval and tracks message ownership"
  3. "includes announcement_message_id in session_joined service message details"

**Changelog:** Added to `changelog/unreleased.md` under Added.
