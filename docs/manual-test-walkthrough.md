# Manual Regression Test Suite

Reusable manual test plan for the Telegram Bridge MCP server. Run through these scenarios after any significant change to verify core functionality.

**Notation:**

- **[Agent]** = agent calls MCP tool
- **[Op]** = operator action on Telegram
- **[Verify]** = expected outcome to confirm

## Prerequisites

1. `pnpm build` — clean
2. `pnpm lint` — clean
3. `pnpm test` — all passing
4. Restart the MCP server (`action(type: "shutdown")` → call any tool to restart)
5. `action(type: "session/start")` — fresh session (SID 1)
6. `action(type: "profile/topic", topic: "🧪 Test")` with a test label

---

## Part A — Single-Session Tests

### A1. Session Basics

| Step | Action | Expected |
| --- | --- | --- |
| A1.1 | [Agent] `action(type: "session/list")` | Returns SID 1 "Primary", `active_sid: 1` |
| A1.2 | [Agent] `action(type: "chat/info")` | Returns bot username, MCP version, commit hash, build time |
| A1.3 | [Agent] `action(type: "profile/topic", topic: "🧪 Test")` then `send("Hello")` | Message appears with `**[🧪 Test]**` prefix |
| A1.4 | [Agent] `action(type: "profile/topic", topic: "")` then `send("Hello")` | Message appears without prefix |

### A2. Messaging

| Step | Action | Expected |
| --- | --- | --- |
| A2.1 | [Agent] `send("Hello")` | Message appears in Telegram |
| A2.2 | [Agent] `send(type: "choice", options: [...])` with 2 options | Message + buttons appear |
| A2.3 | [Op] Press a button | [Agent] receives callback via `dequeue` with `data`, `qid`, `target` |
| A2.4 | [Agent] `action(type: "acknowledge", callback_query_id: "<qid from button press>")` | Toast notification shown to operator |
| A2.5 | [Agent] `send(type: "notification", title, text, severity: "info")` | Notification appears in chat |
| A2.6 | [Agent] `send("Hello")` → capture `msg_id` → `action(type: "message/edit", message_id: msg_id, text: new_text)` | Message content updated in-place |
| A2.7 | [Agent] `send("Hello")` → `send(type: "append", message_id: msg_id, text: extra)` | Message now has original + appended text |
| A2.8 | [Agent] `send("Hello")` → `action(type: "message/delete", message_id: msg_id)` | Message removed from chat |
| A2.9 | [Agent] `send("Hello")` → `action(type: "message/pin", message_id: msg_id)` | Message pinned in chat |

### A3. Interactive Tools

| Step | Action | Expected |
| --- | --- | --- |
| A3.1 | [Agent] `send(type: "question", confirm: "Test?")` → [Op] presses Yes | Returns `{ confirmed: true }` |
| A3.2 | [Agent] `send(type: "question", confirm: "Test?")` → [Op] presses No | Returns `{ confirmed: false }` |
| A3.3 | [Agent] `send(type: "question", text: "Pick one", choose: [3 options])` → [Op] picks one | Returns `{ label, value }` matching selection |
| A3.4 | [Agent] `send(type: "question", ask: "Type something")` → [Op] types response | Returns `{ text }` with operator's input |
| A3.5 | [Agent] `send(type: "choice", options: [2 options])` → [Op] presses one | Callback received via `dequeue` |

### A4. Animations and Typing

| Step | Action | Expected |
| --- | --- | --- |
| A4.1 | [Agent] `send(type: "animation", preset: "thinking")` | Animated message appears, frames cycling |
| A4.2 | Wait 3s → [Agent] `action(type: "animation/cancel")` | Animation stops, static text remains |
| A4.3 | [Agent] `action(type: "show-typing")` | Typing indicator appears in chat |
| A4.4 | [Agent] `action(type: "animation/default", preset: "working")` → `send(type: "animation")` (no preset) | Working animation plays using new default |
| A4.5 | [Agent] `action(type: "animation/cancel")` | Stops cleanly |

### A5. Reactions

| Step | Action | Expected |
| --- | --- | --- |
| A5.1 | [Op] Sends a message → [Agent] `action(type: "react", message_id: msg_id, emoji: "👍")` | 👍 reaction appears on operator's message |

### A6. Checklist and Progress

| Step | Action | Expected |
| --- | --- | --- |
| A6.1 | [Agent] `send(type: "checklist", title, steps: [3 pending steps])` | Checklist message with 3 unchecked items |
| A6.2 | [Agent] `action(type: "checklist/update", message_id: msg_id, steps: [step 1 done])` | First item shows checked |
| A6.3 | [Agent] `action(type: "checklist/update", message_id: msg_id, steps: [all done])` | All items checked |
| A6.4 | [Agent] `send(type: "progress", title: label, percent: 0)` | Progress bar at 0% |
| A6.5 | [Agent] `action(type: "progress/update", message_id: msg_id, percent: 50)` | Bar at 50% |
| A6.6 | [Agent] `action(type: "progress/update", message_id: msg_id, percent: 100)` | Bar at 100% |

### A7. Message Inspection

| Step | Action | Expected |
| --- | --- | --- |
| A7.1 | [Agent] `send(type: "text")` → `action(type: "message/get", message_id: msg_id)` | Returns content, timestamp, sid, versions |
| A7.2 | [Agent] `get_chat` → [Op] presses Allow | Returns chat id, type, title, description |

### A8. Diagnostics

| Step | Action | Expected |
| --- | --- | --- |
| A8.1 | [Agent] `get_debug_log` | Returns recent entries with categories: session, route, animation, queue |
| A8.2 | [Agent] `dump_session_record` | Returns file with full event timeline |

### A9. Reply-To and Callback Routing

| Step | Action | Expected |
| --- | --- | --- |
| A9.1 | [Agent] `send(type: "text")` → [Op] replies to it → [Agent] `dequeue` | Reply received with `reply_to` field, `routing: "targeted"` |
| A9.2 | [Agent] `send(type: "question", confirm: "...")` → [Op] presses button | Callback has `routing: "targeted"`, `target` = prompt msg\_id |

### A10. Edge Cases

| Step | Action | Expected |
| --- | --- | --- |
| A10.1 | [Op] Sends 5 messages rapidly → [Agent] `dequeue` loop | All 5 received in order, no drops, no duplicates |
| A10.2 | [Op] Sends voice message → [Agent] `dequeue` | Voice event with `text` (transcription) and `file_id`; 🫡 reaction auto-set |
| A10.3 | [Agent] `action(type: "commands/set", commands: [{command: "test", description: "Test"}])` → [Op] sends `/test` | Command received as message event |

---

## Part B — Multi-Session Tests

> Requires 2+ MCP clients connected simultaneously.
> See `docs/multi-session-test-script.md` for the full multi-session test plan.

### B1. Session Lifecycle

| Step | Action | Expected |
| --- | --- | --- |
| B1.1 | [S1] already connected → [S2] `action(type: "session/start", name: "Scout")` | S2 gets SID 2, `sessions_active: 2`, `fellow_sessions` lists S1 |
| B1.2 | [S2] `action(type: "session/list")` | Both sessions listed with SIDs and names |
| B1.3 | [S2] `action(type: "session/close")` → [S2] `action(type: "session/start", name: "Scout")` | Fresh SID, clean rejoin |

### B2. Targeted Routing

| Step | Action | Expected |
| --- | --- | --- |
| B2.1 | [S1] `send(type: "text", text: "I'm S1")` → [Op] replies | Only S1 receives reply (`routing: "targeted"`) |
| B2.2 | [S2] `send(type: "text", text: "I'm S2")` → [Op] replies | Only S2 receives reply |
| B2.3 | [S1] `send(type: "question", confirm: "...")` prompt → [Op] presses button | Only S1 receives callback |

### B3. Governor Routing

| Step | Action | Expected |
| --- | --- | --- |
| B3.1 | [Op] Sends plain message (not a reply) | Only governor (S1, lowest SID) receives it |
| B3.2 | [S1] `action(type: "message/route", message_id: msg_id, target_sid: 2)` | S2 receives the message |
| B3.3 | [S1] `action(type: "session/close")` → [Op] sends plain message | S2 (now governor) receives it |

### B4. DM Permissions

| Step | Action | Expected |
| --- | --- | --- |
| B4.1 | DM auto-granted on session approval | S1↔S2 bidirectional after S2 approved |
| B4.2 | [S2] `send(type: "dm", target_sid: 1, text)` | S1 receives `direct_message` event |
| B4.3 | [S2] `action(type: "session/close")` | DM permissions for S2 revoked |

### B5. Health Check

| Step | Action | Expected |
| --- | --- | --- |
| B5.1 | Governor stops polling for >6 minutes | Operator gets 3-option prompt (reroute/promote/wait) |
| B5.2 | Governor resumes polling | "Session is back online" notification |

---

## Known Issues

- **`get_chat` timeout**: The 60-second approval prompt may time out before the operator can respond. The `pollButtonPress` mechanism may have a race condition with session-queue routing. Tracked for investigation.

---

## Test Run Log

### 2026-03-18 — v4-multi-session (commit 91d5bb0)

- **Part A**: All scenarios passed except A7.2 (`get_chat` timed out twice)
- **Part B**: Not yet tested (requires second MCP client)
- **Test suite**: 72 files, 1394 tests passing
- **Build**: Clean (tsc + eslint)
