# Multi-Session Manual Test Script

Step-by-step live testing guide. The operator follows these instructions on Telegram while one or more MCP agent sessions are connected.

## Prerequisites

- MCP server running with `TELEGRAM_MCP_DEBUG=1` env var set in config
- One MCP client connected as **Session 1 (S1)** — typically the primary agent
- A second MCP client ready to connect as **S2** (e.g. another VS Code window, Claude Code, or any MCP client)
- Telegram chat open on the operator's device

## Notation

- **[Op]** = Operator action on Telegram
- **[S1]** / **[S2]** / **[S3]** = Agent session action (tool call)
- **[Verify]** = Expected outcome to confirm

---

## Phase 1 — Targeted Routing (Reply-To)

> The most critical behavior: replies and callbacks must reach the correct
> session. If this fails, nothing else matters. Test it first.

### 1.0 Setup — Start Both Sessions

1. **[S1]** `session_start` (already done or do now)
2. **[Verify]** S1 received `{ sid: 1, pin: ..., sessions_active: 1 }`
3. **[S2]** `session_start` with `name: "Scout"` (or any name)
4. **[Verify]** S2 received `{ sid: 2, sessions_active: 2 }` (no routing_mode field — routing is automatic)

### 1.1 Reply-To — Session 1

1. **[S1]** `send_text` with text: `"I'm session 1"`
2. **[Op]** Reply to S1's message: `"Got it, S1."`
3. **[Verify]** Only S1 receives the reply via `dequeue_update`
4. **[Verify]** S2 does NOT receive it
5. **[Verify]** Server stderr shows `[dbg:route] targeted event=X → sid=1`

### 1.2 Reply-To — Session 2

1. **[S2]** `send_text` with text: `"I'm session 2"`
2. **[Op]** Reply to S2's message: `"Got it, S2."`
3. **[Verify]** Only S2 receives the reply via `dequeue_update`
4. **[Verify]** S1 does NOT receive it
5. **[Verify]** Server stderr shows `[dbg:route] targeted event=X → sid=2`

### 1.3 Callback Routing

1. **[S1]** `confirm` with prompt: `"Ready to continue?"`
2. **[Op]** Press the button
3. **[Verify]** Only S1 receives the callback
4. **[Verify]** S2 does NOT receive it

---

## Phase 2 — Session Lifecycle

### 2.1 Session Details

1. **[Verify]** S2's `session_start` response (from Phase 1 setup) includes:
   - `fellow_sessions` array listing S1
2. **[Verify]** Intro message in Telegram shows "Session 2 · Scout"
3. **[Verify]** Server stderr shows debug traces:
   - `[dbg:session] created sid=2 name="Scout"`
   - `[dbg:queue] created queue for sid=2`
   - `[dbg:session] active 0 → 2`

### 2.2 List Sessions

1. **[S2]** `list_sessions`
2. **[Verify]** Response lists both sessions with SIDs, names, creation times
3. **[S1]** `list_sessions`
4. **[Verify]** Same listing, but `active` field shows S1's own SID

### 2.3 Close and Rejoin

1. **[S2]** `close_session` (with auth)
2. **[Verify]** Server stderr shows `[dbg:session] closed sid=2`
3. **[S2]** `session_start` with `name: "Scout"` again
4. **[Verify]** S2 gets a fresh SID (may be 2 again or next available)
5. **[Verify]** `list_sessions` from S1 shows the rejoined session

---

## Phase 3 — Ambiguous Message Routing

> When two or more sessions are active, the first (lowest-SID) session is automatically
> designated governor. All ambiguous messages (not a reply, callback, or reaction) are
> delivered only to the governor, which can then delegate them via `route_message`.

### 3.0 Setup — Verify Governor Assignment

1. **[Verify]** S1 and S2 are both active (from Phase 2 setup or restart)
2. **[Verify]** S2's `session_start` response included `sessions_active: 2`
3. **[Verify]** Server stderr shows `[dbg:session] governor set to sid=1` (auto-set when 2nd session joined)

### 3.1 Ambiguous Message Goes to Governor

1. **[Op]** Send a plain text message (not replying to anything): `"Hello, who gets this?"`
2. **[Verify]** Only S1 (governor) receives it via `dequeue_update`
3. **[Verify]** S2 does NOT receive it
4. **[Verify]** Server stderr shows `[dbg:route] governor event=X → sid=1`

### 3.2 Governor Delegation

1. **[Op]** Send: `"Route this to Scout"`
2. **[Verify]** S1 receives it first
3. **[S1]** Calls `route_message` with `message_id` and `target_sid: 2`
4. **[Verify]** S2 receives the same message via `dequeue_update`
5. **[Verify]** S1 does NOT receive it a second time
6. **[Verify]** Server stderr shows the delegation trace

### 3.3 Governor Continuity

1. **[Op]** Send 3 more plain messages
2. **[Verify]** All 3 go to S1 (governor)
3. **[Verify]** S2 receives none of them

### 3.4 Governor Death Recovery

1. **[S1]** Calls `close_session` (with auth)
2. **[Verify]** Server stderr shows `[dbg:session] closed sid=1`
3. **[Verify]** Server stderr shows governor promoted to S2 (lowest remaining SID)
4. **[Op]** Send: `"Who's in charge now?"`
5. **[Verify]** S2 receives it (S2 is now governor)
6. **[Verify]** Server stderr shows `[dbg:route] governor event=X → sid=2`

---

## Phase 4 — DM Permissions

### 4.1 Request DM Access

1. **[Op]** Switch back to load balance, ensure S1 and S2 are both active (restart S1 if closed)
2. **[S2]** `request_dm_access` targeting S1
3. **[Verify]** Operator sees a confirm prompt: "Session 2 (Scout) wants to send a message to Session 1. Allow?"
4. **[Op]** Press "Allow"
5. **[Verify]** S2's `request_dm_access` resolves with `{ granted: true }`

### 4.2 Send DM

1. **[S2]** `send_direct_message` to S1 with text: `"Hey S1, I found something interesting."`
2. **[Verify]** S1 receives a `direct_message` event via `dequeue_update`
3. **[Verify]** The event has `type: "direct_message"` and `sid` field showing sender
4. **[Verify]** Server stderr shows `[dbg:dm] delivered DM from sid=2 → sid=1`

### 4.3 Permission Denied

1. **[S1]** Tries `send_direct_message` to S2 (without having requested access)
2. **[Verify]** Error: permission denied (DM permissions are directional: S2→S1 was granted, not S1→S2)

### 4.4 Revoke on Close

1. **[S2]** Calls `close_session`
2. **[Verify]** All DM permissions involving S2 are revoked
3. **[Verify]** Server stderr shows `[dbg:dm] revoked N DM permission(s) for sid=2`

---

## Phase 5 — Three Sessions

### 5.1 Scale Up

1. **[S1]** already connected
2. **[S2]** `session_start` with `name: "Analyst"`
3. **[S3]** (third MCP client) `session_start` with `name: "Builder"`
4. **[Verify]** Each session's intro shows correct SID and fellow sessions
5. **[Verify]** `list_sessions` from any session shows all 3

### 5.2 Ambiguous Routing with 3

1. **[Op]** Send 3 plain messages in sequence
2. **[Verify]** All 3 go to the governor (lowest-SID session among the three)
3. **[Verify]** S2 and S3 receive none directly

### 5.3 Governor Delegation with 3

1. **[Op]** Send 2 ambiguous messages
2. **[S_gov]** (the current governor) routes first to S2, second to S3
3. **[Verify]** Each target receives the delegated message
4. **[Verify]** The governor's own queue is not re-filled by its own delegations

### 5.5 Auth Rejection

1. **[S3]** Tries `close_session` with S2's SID but S3's PIN
2. **[Verify]** Auth error — can't close another session with wrong credentials
3. **[Verify]** Server stderr shows `[dbg:session] auth failed sid=2`

---

## Phase 6 — Edge Cases

### 6.1 Cross-Session Outbound Forwarding

1. **[S1]** `send_text` with text: `"S1 speaking"`
2. **[Verify]** S2 receives the outbound event in its queue (cross-session forwarding)
3. **[Verify]** The event has `sid: 1` marking the sender

### 6.2 Rapid Messages

1. **[Op]** Send 5 messages in quick succession
2. **[Verify]** All 5 are distributed correctly (no drops, no duplicates)
3. **[Verify]** Queue pending counts match expected values

### 6.3 Session Close Mid-Conversation

1. **[S2]** is in the middle of processing a message
2. **[S2]** calls `close_session`
3. **[Verify]** S2's queue is removed, remaining sessions unaffected
4. **[Verify]** Subsequent ambiguous messages go only to remaining sessions

### 6.4 Debug Log Review

1. **[Op]** Review server stderr log output
2. **[Verify]** All lifecycle events, routing decisions, and queue operations are traced
3. **[Verify]** Traces cover categories: session, route, cascade, dm, queue

---

## Completion Checklist

- [ ] Targeted routing: reply-to (both sessions), callback
- [ ] Session lifecycle: create, list, close, rejoin
- [ ] Intro enrichment: SID, name, fellow sessions
- [ ] Governor mode: auto-designation, ambiguous delivery, delegation, death recovery
- [ ] DM flow: request, approve, send, directional, revoke on close
- [ ] 3+ sessions: scaling, governor delegation across 3 targets
- [ ] Cross-session outbound forwarding
- [ ] Auth rejection with wrong credentials
- [ ] Debug logging tracks all key events
- [ ] No dropped messages, no duplicates
