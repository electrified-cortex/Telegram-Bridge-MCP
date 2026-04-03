# Multi-Session End-to-End Flow

This document describes the out-of-box experience for multi-session Telegram Bridge MCP. The goal: zero configuration, everything just works.

## Single Session (default)

1. Agent calls `session_start(name: "Primary")`
2. Auto-approved (first session, no gate)
3. SID 1 returned. PIN returned.
4. No name tags. No routing logic. Everything works like v3.x.
5. All tools require `token: number` credentials on every call.

## Second Session Joins

1. Agent calls `session_start(name: "Worker")`
2. **Approval gate:** Operator receives a Telegram `confirm` prompt:
   `🤖 New session requesting access: Worker — ✅ Approve / ❌ Deny`
3. On approval: SID 2 + PIN returned

### Automatic effects (zero config)

These happen immediately, with no operator or agent action required:

| What | How |
| --- | --- |
| Routing → governor | `setRoutingMode("governor", 1)` — SID 1 becomes governor |
| Name tags on messages | Outbound proxy prepends `🤖 Name` to all bot messages |
| Ambiguous → governor | Fresh messages (no reply-to) route to governor's queue |
| Targeted → owner | Reply-to messages route to the session that sent the original |
| Both sessions notified | Internal broadcast: "Multi-session active, routing: governor" |
| Token required | All gated tools now require `token` parameter |

## Message Routing

### Targeted (reply-to)

User replies to a message sent by 🤖 Worker → routed to Worker's session queue. Worker dequeues with `routing: "targeted"`.

### Ambiguous (no reply-to)

User sends a fresh message → routed to governor (SID 1). Governor dequeues with `routing: "ambiguous"`.

**Governor protocol:** Handle it if it's for you. Use `route_message(target_sid)` to forward if it belongs to another session.

**Any-agent protocol:** If you receive an ambiguous message and it's clearly not for you, route it. If unsure, handle it — better to respond than to bounce messages around.

## Session Close

| Event | Effect |
| --- | --- |
| Non-governor closes | Nothing changes. Routing continues. |
| Governor closes | Next-lowest SID promoted to governor. Sessions notified. |
| Last session closes (back to 1) | Name tags stop. Routing disabled. `token` becomes optional again. |
| All sessions close | Clean slate — next `session_start` is auto-approved as session 1. |

## Tool Auth Matrix

| Tool group | Auth required |
| --- | --- |
| `session_start`, `shutdown`, `get_agent_guide`, `get_me`, `list_sessions` | None |
| All other tools (multi-session active) | `token: number` |
| All other tools (single session) | None (backward compat) |

On the wire: `{ "token": 1809146, ... }` — one field, one number (encoding: `sid * 1_000_000 + pin`).

## Task Dependency Chain

```text
100 SID+PIN required on all tools (in-progress)
 └─ 150 Ambiguous message flag in dequeue
 └─ 150 Integration tests
 └─ 200 Governor default routing
 └─ 200 Session approval gate
 └─ 250 Auto-announce multi-session
 └─ 300 Mandatory message headers
 └─ 350 Agent protocol docs
```

Tasks 200+ can be parallelized once 100 is complete.
