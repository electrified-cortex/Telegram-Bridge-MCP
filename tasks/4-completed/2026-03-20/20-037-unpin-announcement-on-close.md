# Task #037: Unpin Session Announcement on close_session

**Priority:** 20 | **Status:** Draft

## Problem

When a session closes, its pinned announcement message remains pinned in the chat. This leaves stale pins that clutter the pin list and can confuse the operator — they point to a session that no longer exists.

## Goal

When `close_session` is called, that session's pinned announcement message is automatically unpinned before the session is removed.

## Background

Each session pins its own announcement message (`announcement_message_id` stored in session context) so the operator can target that session by replying to it. On close, this pin is no longer useful and should be cleaned up.

## Scope

### `src/tools/close_session.ts`

After the session is confirmed as closing (and before the session record is removed):

1. Read `announcement_message_id` from session context
2. If present, call Telegram `unpinChatMessage` with that message ID
3. Swallow any errors (message may already be unpinned or deleted — non-fatal)
4. Broadcast `session_closed` service message as before

### `src/tools/close_session.test.ts`

- Add test: close_session with an `announcement_message_id` set calls `unpinChatMessage`
- Add test: close_session without an announcement gracefully skips unpin

## Acceptance Criteria

- After `close_session`, the session's announcement is unpinned from the chat
- Unpin errors (already unpinned, message deleted) do not fail the close
- Existing close_session behavior and tests unaffected

## Completion

**Finding: Already implemented.** `close_session.ts` lines 53–58 already call `unpinChatMessage` using the stored `announcement_message_id`, with error swallowing. Tests exist in `close_session.test.ts` (line 517, "does not call unpinChatMessage when no announcement", etc.). This was implemented as part of task #022. No code changes needed — closing as duplicate/audit.
