# Multi-Session Acceptance Test Script

> **If this script passes end-to-end, the multi-session feature is cleared for merge.**

Step-by-step test plan requiring 2–3 MCP agent sessions and one operator on Telegram. Each phase builds on the previous one. Do not skip phases.

## Prerequisites

- `pnpm build` clean, `pnpm lint` clean, `pnpm test` all passing
- `mcp-config.json` has `"debug": true`
- MCP server freshly restarted
- **S1** — first MCP client, connected via `session_start` (auto-named "Primary")
- **S2** — second MCP client ready to connect (separate VS Code chat, Claude Code, etc.)
- **S3** — third MCP client (needed for Phase 5 only; can reuse S2 after close)
- Telegram chat open on operator's device

## Notation

- **[S1]** / **[S2]** / **[S3]** = agent session action (tool call)
- **[Op]** = operator action on Telegram
- **[Verify]** = expected outcome — check tool response and/or Telegram UI
- **[Debug]** = check server stderr (debug log via `get_debug_log`)

---

## Phase 1 — Session Lifecycle

### 1.1 First Session

1. **[S1]** already connected via `session_start`
2. **[Verify]** `{ sid: 1, sessions_active: 1 }`

### 1.2 Second Session Joins

1. **[S2]** `session_start` with `name: "Scout"`
2. **[Verify]** Operator gets approval prompt in Telegram
3. **[Op]** Approve S2
4. **[Verify]** S2 receives `{ sid: 2, sessions_active: 2, fellow_sessions: [{sid: 1, name: "Primary"}] }`
5. **[Verify]** Intro message shows session identity (SID, name)
6. **[Debug]** `created sid=2 name="Scout"`, `governor set to sid=1`

### 1.3 Auto-DM Grant

1. **[Verify]** S2's approval auto-grants bidirectional DM (S1↔S2)
2. **[Debug]** DM grant log entries

### 1.4 List Sessions

1. **[S1]** `list_sessions` → both sessions listed
2. **[S2]** `list_sessions` → same list, `active_sid` matches caller

### 1.5 Name Collision Guard

1. **[S2 or another client]** Try `session_start` with `name: "Primary"`
2. **[Verify]** Rejected — name already taken

---

## Phase 2 — Targeted Routing

> The most critical behavior: replies and callbacks must reach the correct session only.

### 2.1 Reply-To — Session 1

1. **[S1]** `send_text("I'm session 1")`
2. **[Op]** Reply to S1's message: "Got it, S1."
3. **[Verify]** Only S1 receives the reply via `dequeue_update`
4. **[Verify]** S2 does NOT receive it
5. **[Debug]** `targeted event=X → sid=1`

### 2.2 Reply-To — Session 2

1. **[S2]** `send_text("I'm session 2")`
2. **[Op]** Reply to S2's message: "Got it, S2."
3. **[Verify]** Only S2 receives the reply
4. **[Verify]** S1 does NOT receive it
5. **[Debug]** `targeted event=X → sid=2`

### 2.3 Callback Routing

1. **[S1]** `confirm("Ready to continue?")`
2. **[Op]** Press the button
3. **[Verify]** Only S1 receives the callback
4. **[Verify]** S2 does NOT receive it

---

## Phase 3 — Governor Routing

> First session (lowest SID) is automatically the governor. All ambiguous messages
> (not a reply, callback, or reaction) go only to the governor.

### 3.1 Verify Governor

1. **[Debug]** `governor set to sid=1` (from Phase 1.2)
2. **[S1]** is the governor

### 3.2 Ambiguous Message

1. **[Op]** Send a plain text message (not a reply): "Hello, who gets this?"
2. **[Verify]** Only S1 (governor) receives it
3. **[Verify]** S2 does NOT receive it
4. **[Debug]** `governor event=X → sid=1`

### 3.3 Governor Delegation

1. **[Op]** Send: "Route this to Scout"
2. **[Verify]** S1 receives it
3. **[S1]** `route_message(message_id, target_sid: 2)`
4. **[Verify]** S2 receives the message
5. **[Verify]** S1 does NOT receive it a second time

### 3.4 Governor Continuity

1. **[Op]** Send 3 more plain messages
2. **[Verify]** All 3 go to S1 (governor)
3. **[Verify]** S2 receives none

### 3.5 Governor Death Recovery

1. **[S1]** `close_session`
2. **[Debug]** `closed sid=1`, governor promoted to S2
3. **[Op]** Send: "Who's in charge now?"
4. **[Verify]** S2 receives it (S2 is now governor)
5. **[Debug]** `governor event=X → sid=2`

---

## Phase 4 — DM Permissions

> DMs are auto-granted bidirectionally on session approval (Phase 1.3).
> This phase tests the DM flow and revocation.

### 4.0 Setup

1. Restart S1 if closed in Phase 3.5: **[S1]** `session_start`
2. Both S1 and S2 active

### 4.1 Send DM (Auto-Granted)

1. **[S2]** `send_direct_message(target_sid: 1, text: "Hey S1, found something.")`
2. **[Verify]** S1 receives a `direct_message` event via `dequeue_update`
3. **[Verify]** Event has sender SID field
4. **[Debug]** `delivered DM from sid=2 → sid=1`

### 4.2 Bidirectional

1. **[S1]** `send_direct_message(target_sid: 2, text: "Thanks, S2.")`
2. **[Verify]** S2 receives the DM

### 4.3 Revoke on Close

1. **[S2]** `close_session`
2. **[Verify]** DM permissions involving S2 revoked
3. **[Debug]** DM revocation log

### 4.4 Manual DM Request (New Session)

1. **[S2]** `session_start(name: "Scout")` → operator approves → auto-DM-grant
2. **[S2]** `send_direct_message(target_sid: 1, text: "I'm back")` → works immediately

---

## Phase 5 — Three Sessions

### 5.1 Scale Up

1. **[S1]** active, **[S2]** active
2. **[S3]** `session_start(name: "Builder")` → operator approves
3. **[Verify]** 3 sessions active, each sees fellow sessions
4. **[Verify]** `list_sessions` from any session shows all 3

### 5.2 Ambiguous Routing with 3

1. **[Op]** Send 3 plain messages
2. **[Verify]** All 3 go to governor (lowest SID)
3. **[Verify]** S2 and S3 receive none

### 5.3 Governor Delegation with 3

1. **[Op]** Send 2 ambiguous messages
2. **[Gov]** Routes first to S2, second to S3
3. **[Verify]** Each target receives its delegated message
4. **[Verify]** Governor queue not re-filled by its own delegations

### 5.4 Auth Rejection

1. **[S3]** Tries `close_session` with S2's SID but S3's PIN
2. **[Verify]** Auth error — wrong credentials
3. **[Debug]** `auth failed sid=2`

---

## Phase 6 — Edge Cases

### 6.1 Cross-Session Outbound Forwarding

1. **[S1]** `send_text("S1 speaking")`
2. **[Verify]** S2 receives an outbound event with `sid: 1`

### 6.2 Rapid Messages

1. **[Op]** Send 5 messages quickly
2. **[Verify]** All 5 distributed correctly, no drops, no duplicates

### 6.3 Session Close Mid-Conversation

1. **[S2]** `close_session` while messages are in its queue
2. **[Verify]** S2's queue removed, other sessions unaffected
3. **[Verify]** Subsequent ambiguous messages go to remaining sessions only

### 6.4 Voice Messages

1. **[Op]** Send a voice message
2. **[Verify]** Governor receives it with transcription
3. **[Verify]** 🫡 reaction auto-set

### 6.5 Debug Log Completeness

1. **[Any]** `get_debug_log`
2. **[Verify]** Entries cover: `session`, `route`, `queue`, `dm`, `animation`
3. **[Verify]** All lifecycle and routing events are traced

---

## Completion Checklist

- [ ] Session lifecycle: create, approve, list, close, rejoin
- [ ] Auto-DM-grant on approval
- [ ] Name collision rejection
- [ ] Targeted routing: reply-to (both sessions), callback
- [ ] Governor auto-designation on 2nd session join
- [ ] Ambiguous messages → governor only
- [ ] Governor delegation via `route_message`
- [ ] Governor death → promotion to next lowest SID
- [ ] DM send, bidirectional, revoke on close
- [ ] 3-session scaling + delegation
- [ ] Auth rejection (wrong SID/PIN)
- [ ] Cross-session outbound forwarding
- [ ] Rapid messages — no drops, no duplicates
- [ ] Voice transcription + 🫡 reaction
- [ ] Debug log covers all categories
