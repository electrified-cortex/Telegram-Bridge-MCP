# Manual E2E Demo Steps

## AC3 — Sub-agent uses child_token; operator sees `[Helper] <text>`; reply lands in child dequeue only

**Setup:** Bridge running, primary session active as governor.

1. From the primary session, spawn a child:
   ```
   action(type: "session/spawn-child", token: <parent_token>, name: "Helper")
   ```
   Note the returned `token` (use as `child_token`) and `sid`.

2. From a second agent process (or a second MCP client), call:
   ```
   dequeue(token: <child_token>)
   ```
   The child session is now live and polling.

3. From the **child session**, send a message to the operator:
   ```
   send(token: <child_token>, text: "Hello from Helper")
   ```

4. **Verify in Telegram:** The operator sees the message prefixed with the child's topic label,
   e.g. `[Helper]` followed by the message text — not the parent's label or the color-coded name tag.

5. Reply to that message in Telegram (or send a new message in the chat).

6. Call `dequeue(token: <child_token>)` — the reply arrives **only** in the child's queue.

7. Call `dequeue(token: <parent_token>)` — the reply does **not** appear there.

---

## AC3b — Operator non-reply during active child session → parent queue; `child/forward` → child dequeue

**Setup:** Bridge running, primary (parent) session active as governor, child session active.

1. From any MCP client, send a message in the shared Telegram chat **without replying** to any specific bot message.

2. **Verify:** The message arrives in the **parent session's dequeue** (not the child's), because TMCP routes ambiguous messages to the governor/parent.

3. From the parent session, call:
   ```
   action(type: "child/forward", token: <parent_token>, child_sid: <child_sid>, message: "<forwarded text>")
   ```
   Returns `{ forwarded: true, child_sid: <N> }`.

4. From the child session, call:
   ```
   dequeue(token: <child_token>)
   ```
   **Verify:** The forwarded message appears in the child's dequeue as a `service_message` with `event_type: "parent_forward"`.

5. **Non-parent caller test (AC3c):** Call `child/forward` with a different session's token → expect `UNAUTHORIZED`.

---

## AC8-P1 — `spawn-child` triggers operator approval ticket flow

**Setup:** Bridge running with a primary (governor) session already active.

1. From any MCP client with a valid `parent_token`, call:
   ```
   action(type: "session/spawn-child", token: <parent_token>, name: "Helper")
   ```

2. **Verify in Telegram:** The bot immediately posts an approval dialog:
   > *New session requesting access:* Helper
   > [🟦] [🟩] [🟨] [🟧] [🟥] [🟪]   [☐ Delegate] [⛔ Deny]

   This is the standard `session/start` approval flow firing naturally because
   `spawn-child` delegates to `handleSessionStart` internally.

3. Tap a color button to approve. The dialog is deleted and the child session
   comes online (announcement posted, child token returned to the caller).

4. Tap **⛔ Deny** instead — the dialog updates to "Session denied: Helper ✗"
   and `spawn-child` returns `{ code: "SESSION_DENIED", ... }`.

5. **Governor inbox:** While the dialog is pending, the governor session receives
   a service message:
   > **Pending approval:**
   > **Session:** Helper
   > **Ticket:** `<ticket_id>`
   > **Action:** `action(type: 'approve', token: <governor_token>, ticket: <ticket_id>)`

   The governor can approve programmatically without touching Telegram.
