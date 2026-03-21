# Task #047 — Deferred Session Announcement Pinning

## Context

Currently, `session_start` always pins the announcement message immediately — even for single-session usage. This creates unnecessary pin noise when only one agent is running.

The operator wants a quieter single-session experience: send the announcement but defer pinning until a second session joins.

## Current Behavior

In `src/tools/session_start.ts`:
- **First session** (~line 204–215): Sends announcement, pins immediately with `disable_notification: true`
- **Second+ session** (~line 239–250): Sends announcement, also pins immediately

In `src/tools/close_session.ts` (~line 53–58): Unpins announcement on session close.

In `src/shutdown.ts` (~line 74–83): Unpins all announcements on graceful shutdown.

## Desired Behavior

1. **First session joins**: Send announcement, store message ID, **do NOT pin**
2. **Second session joins**: Pin the first session's announcement, then send + pin the second session's announcement
3. **Session closes**: Unpin as before
4. **Back to single session**: If we go from 2 sessions to 1, unpin the remaining session's announcement (it's now the only one — no need for pins)
5. **Shutdown**: Unpin all as before (no change needed, already best-effort)

## Implementation Plan

1. **`session_start.ts` first-session branch** (~line 215): Remove `pinChatMessage` call. The announcement message ID is already stored via `setSessionAnnouncementMessage`.

2. **`session_start.ts` multi-session branch** (~line 227+): When `sessionsActive === 2`, retroactively pin the first session's announcement:
   ```ts
   // Pin the first session's announcement retroactively
   for (const fellow of allSessions.filter(s => s.sid !== session.sid)) {
     const fellowAnnouncement = getSessionAnnouncementMessage(fellow.sid);
     if (fellowAnnouncement !== undefined) {
       getApi().pinChatMessage(chatId, fellowAnnouncement, { disable_notification: true }).catch(() => {});
     }
   }
   ```
   Then pin the new session's announcement as currently done.

3. **`close_session.ts`**: When closing brings active count from 2 → 1, unpin the remaining session's announcement (since we're back to single-session mode):
   ```ts
   if (remaining.length === 1) {
     const lastAnnouncement = getSessionAnnouncementMessage(remaining[0].sid);
     if (lastAnnouncement !== undefined) {
       getApi().unpinChatMessage(chatId, lastAnnouncement).catch(() => {});
     }
   }
   ```

4. **Tests**: Update existing session_start and close_session tests to verify:
   - First session announcement is NOT pinned
   - Second session triggers pinning of both announcements
   - Closing down to 1 session unpins the remaining announcement

## Acceptance Criteria

- [ ] Single-session usage produces zero pin notifications
- [ ] Multi-session mode pins all active session announcements
- [ ] Returning to single-session unpins the last remaining announcement
- [ ] All existing tests pass + new tests cover the deferred pinning logic
- [ ] Shutdown cleanup unchanged (still unpins all)
