# Task #022 — Pin Session Announcement Message

| Field    | Value                                              |
| -------- | -------------------------------------------------- |
| Priority | 20 (high — improves multi-session UX)             |
| Status   | Draft                                              |
| Created  | 2026-03-19                                         |

## Goal

When a session's announcement message is sent (the "Session N — 🟢 Online" banner in the chat), pin it automatically. When that session closes, unpin it.

## Behavior

- **On session start:** After `sendMessage` returns the announcement `message_id`, call `pinChatMessage(chatId, announcementMsgId)` with `disable_notification: true`.
- **On session close:** Look up the stored announcement message ID for that session and call `unpinChatMessage(chatId, announcementMsgId)`. Failures are fire-and-forget (`.catch(() => {})`).
- **First session:** Currently sends no announcement (single-session, no operator gate). If task #018 is implemented first (first-session announcement), pin/unpin logic applies there too. If not, skip for first session.
- **Reconnect:** If a session reconnects and sends a new announcement, pin the new one. The old pin (if any) may have been unpinned on close — no special handling needed.

## Implementation Notes

### 1. Store announcement message ID per session

In `src/session-manager.ts`, add `announcementMsgId?: number` to the `Session` interface and a setter/getter:

```ts
export function setSessionAnnouncementMessage(sid: number, msgId: number): void
export function getSessionAnnouncementMessage(sid: number): number | undefined
```

### 2. Pin on announce (`src/tools/session_start.ts`)

After `trackMessageOwner(announcementMsgId, session.sid)`, add:

```ts
setSessionAnnouncementMessage(session.sid, announcementMsgId);
getApi().pinChatMessage(chatId, announcementMsgId, { disable_notification: true }).catch(() => {});
```

### 3. Unpin on close (`src/tools/close_session.ts`)

After `closeSession(sid)` succeeds, look up and unpin:

```ts
const announcementMsgId = getSessionAnnouncementMessage(sid);
if (announcementMsgId !== undefined) {
  getApi().unpinChatMessage(chatId, announcementMsgId).catch(() => {});
}
```

### 4. Telegram Bot API note

`pinChatMessage` and `unpinChatMessage` are standard Bot API methods. The bot must have "Pin Messages" permission in the group/channel. In a private chat with the operator, pinning works without extra permissions.

## Scope

- `src/session-manager.ts` — add `announcementMsgId` field + setter/getter
- `src/tools/session_start.ts` — store + pin after announcement
- `src/tools/close_session.ts` — unpin on close
- Tests for pin/unpin calls in `session_start.test.ts` and `close_session.test.ts`
- No changelog entry needed until implementation

## Worktree

```
20-022-pin-session-announcement
task/022-pin-session-announcement
```

## Dependencies

- Task #530 (session join broadcast announcement) — already merged. Announcement msg ID infrastructure exists.
- Task #018 (first-session announcement) — optional dependency. If merged first, apply pin/unpin to first session too.
