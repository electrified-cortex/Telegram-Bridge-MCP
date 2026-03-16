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

## Phase 1 — Session Lifecycle (2 sessions)

### 1.1 Baseline — S1 Already Connected

1. **[S1]** `session_start` (already done)
2. **[Verify]** S1 received `{ sid: 1, pin: ..., sessions_active: 1 }`
3. **[Verify]** Server stderr shows session-1 creation traces (requires `TELEGRAM_MCP_DEBUG=1`)

### 1.2 Second Session Joins

1. **[S2]** `session_start` with `name: "Scout"` (or any name)
2. **[Verify]** S2 response includes:
   - `sid: 2`
   - `sessions_active: 2`
   - `fellow_sessions` array listing S1
   - `routing_mode: "load_balance"`
3. **[Verify]** Intro message in Telegram shows "Session 2 · Scout"
3. **[Verify]** Server stderr shows debug traces:
   - `[dbg:session] created sid=2 name="Scout"`
   - `[dbg:queue] created queue for sid=2`
   - `[dbg:session] active 0 → 2`

### 1.3 List Sessions

1. **[S2]** `list_sessions`
2. **[Verify]** Response lists both sessions with SIDs, names, creation times
3. **[S1]** `list_sessions`
4. **[Verify]** Same listing, but `active` field shows S1's own SID

---

## Phase 2 — Message Routing (Load Balance)

### 2.1 Ambiguous Message — Load Balance

1. **[Op]** Send a plain text message (not replying to anything): `"Hello, who gets this?"`
2. **[Verify]** Exactly one session receives it via `dequeue_update`
3. **[Op]** Send another plain text: `"And this one?"`
4. **[Verify]** The other session receives it (round-robin)
5. **[Verify]** Server stderr shows `[dbg:route] load_balance event=X → sid=Y`

### 2.2 Targeted Message — Reply-To

1. **[S1]** `send_text` with text: `"I'm session 1"`
2. **[Op]** Reply to S1's message: `"Got it, S1."`
3. **[Verify]** Only S1 receives the reply via `dequeue_update`
4. **[Verify]** S2 does NOT receive it
5. **[Verify]** Server stderr shows `[dbg:route] targeted event=X → sid=1`

### 2.3 Targeted Message — Callback

1. **[S1]** `confirm` with prompt: `"Ready to continue?"`
2. **[Op]** Press the button
3. **[Verify]** Only S1 receives the callback
4. **[Verify]** S2 does NOT receive it

---

## Phase 3 — Cascade Mode

### 3.1 Switch to Cascade

1. **[Op]** Send `/routing` → select "Cascade"
2. **[Verify]** Panel shows Cascade as active mode

### 3.2 Cascade Priority

1. **[S1]** Call `dequeue_update(timeout: 60)` (S1 is now idle/waiting)
2. **[Op]** Send: `"Cascade test message"`
3. **[Verify]** S1 receives it (lowest SID, AND it's idle → priority)
4. **[Verify]** Server stderr shows `[dbg:cascade] routed event=X → sid=1 idle=true`

### 3.3 Cascade Pass

1. **[S1]** receives the message but decides to pass: `pass_message` with `message_id` of the cascaded message
2. **[Verify]** `pass_message` returns `{ forwarded_to: 2 }`
3. **[Verify]** S2 now receives the same message via `dequeue_update`
4. **[Verify]** Server stderr shows `[dbg:cascade] pass msg=X from sid=1 → sid=2`

### 3.4 Cascade Timeout

1. **[Op]** Send another message while S1 is busy (not calling `dequeue_update`)
2. **[Verify]** S1 receives it with a `pass_by` deadline in the dequeue response
3. **[Verify]** If S1 doesn't pass or handle within the deadline window, the message is still in S1's queue (no auto-forward — agents must call `pass_message`)

---

## Phase 4 — Governor Mode

### 4.1 Switch to Governor

1. **[Op]** Send `/routing` → select "Governor"
2. **[Verify]** Panel asks which session is the governor (or defaults to S1)
3. **[Op]** Select S1 as governor

### 4.2 Governor Receives All Ambiguous

1. **[Op]** Send: `"Route this wherever it belongs"`
2. **[Verify]** Only S1 (governor) receives it
3. **[S1]** Calls `route_message` with `message_id` and `target_sid: 2`
4. **[Verify]** S2 receives the message
5. **[Verify]** Server stderr shows `[dbg:route] governor event=X → sid=1` then `[dbg:route] governor delegated msg=X → sid=2`

### 4.3 Governor Death Recovery

1. **[S1]** Calls `close_session` (with auth)
2. **[Verify]** Routing mode automatically resets to `load_balance`
3. **[Verify]** Operator sees a notification about governor shutdown and mode reset
4. **[Verify]** Server stderr shows `[dbg:session] closed sid=1` and routing mode change

---

## Phase 5 — DM Permissions

### 5.1 Request DM Access

1. **[Op]** Switch back to load balance, ensure S1 and S2 are both active (restart S1 if closed)
2. **[S2]** `request_dm_access` targeting S1
3. **[Verify]** Operator sees a confirm prompt: "Session 2 (Scout) wants to send a message to Session 1. Allow?"
4. **[Op]** Press "Allow"
5. **[Verify]** S2's `request_dm_access` resolves with `{ granted: true }`

### 5.2 Send DM

1. **[S2]** `send_direct_message` to S1 with text: `"Hey S1, I found something interesting."`
2. **[Verify]** S1 receives a `direct_message` event via `dequeue_update`
3. **[Verify]** The event has `type: "direct_message"` and `sid` field showing sender
4. **[Verify]** Server stderr shows `[dbg:dm] delivered DM from sid=2 → sid=1`

### 5.3 Permission Denied

1. **[S1]** Tries `send_direct_message` to S2 (without having requested access)
2. **[Verify]** Error: permission denied (DM permissions are directional: S2→S1 was granted, not S1→S2)

### 5.4 Revoke on Close

1. **[S2]** Calls `close_session`
2. **[Verify]** All DM permissions involving S2 are revoked
3. **[Verify]** Server stderr shows `[dbg:dm] revoked N DM permission(s) for sid=2`

---

## Phase 6 — Three Sessions

### 6.1 Scale Up

1. **[S1]** already connected
2. **[S2]** `session_start` with `name: "Analyst"`
3. **[S3]** (third MCP client) `session_start` with `name: "Builder"`
4. **[Verify]** Each session's intro shows correct SID and fellow sessions
5. **[Verify]** `list_sessions` from any session shows all 3

### 6.2 Load Balance with 3

1. **[Op]** Send 3 plain messages in sequence
2. **[Verify]** Each session receives exactly one (round-robin distribution)
3. **[Op]** Send 3 more
4. **[Verify]** Distribution continues cycling

### 6.3 Cascade with 3

1. **[Op]** Switch to cascade mode
2. **[Op]** Send a message while all 3 are idle
3. **[Verify]** S1 gets it (lowest SID + idle)
4. **[S1]** Passes → goes to S2
5. **[S2]** Passes → goes to S3
6. **[S3]** Handles it (no one left to pass to)
7. **[Verify]** Server stderr shows full cascade chain

### 6.4 Governor with 3

1. **[Op]** Switch to governor, designate S1
2. **[Op]** Send 2 messages
3. **[S1]** Routes first to S2, second to S3
4. **[Verify]** Each target receives the delegated message

### 6.5 Auth Rejection

1. **[S3]** Tries `close_session` with S2's SID but S3's PIN
2. **[Verify]** Auth error — can't close another session with wrong credentials
3. **[Verify]** Server stderr shows `[dbg:session] auth failed sid=2`

---

## Phase 7 — Edge Cases

### 7.1 Cross-Session Outbound Forwarding

1. **[S1]** `send_text` with text: `"S1 speaking"`
2. **[Verify]** S2 receives the outbound event in its queue (cross-session forwarding)
3. **[Verify]** The event has `sid: 1` marking the sender

### 7.2 Rapid Messages

1. **[Op]** Send 5 messages in quick succession
2. **[Verify]** All 5 are distributed correctly (no drops, no duplicates)
3. **[Verify]** Queue pending counts match expected values

### 7.3 Session Close Mid-Conversation

1. **[S2]** is in the middle of processing a message
2. **[S2]** calls `close_session`
3. **[Verify]** S2's queue is removed, remaining sessions unaffected
4. **[Verify]** Subsequent ambiguous messages go only to remaining sessions

### 7.4 Debug Log Review

1. **[Op]** Review server stderr log output
2. **[Verify]** All lifecycle events, routing decisions, and queue operations are traced
3. **[Verify]** Traces cover categories: session, route, cascade, dm, queue

---

## Completion Checklist

- [ ] Session lifecycle: create, list, close
- [ ] Intro enrichment: SID, name, fellow sessions
- [ ] Load balance routing: round-robin, fair distribution
- [ ] Targeted routing: reply-to, callback, reaction
- [ ] Cascade mode: priority order, pass, pass-by deadlines
- [ ] Governor mode: designation, delegation, death recovery
- [ ] DM flow: request, approve, send, directional, revoke on close
- [ ] 3+ sessions: scaling, all modes
- [ ] Cross-session outbound forwarding
- [ ] Auth rejection with wrong credentials
- [ ] Debug logging tracks all key events
- [ ] No dropped messages, no duplicates
