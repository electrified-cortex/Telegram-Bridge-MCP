# Multi-Session Routing Protocol

How message routing works when multiple agent sessions are active. This document
covers the human experience, the agent protocol, and failure recovery.

---

## Concepts

| Term | Meaning |
| --- | --- |
| **Session** | One agent connected to the bridge. Identified by a SID (auto-incrementing). |
| **Governor** | The session that triages ambiguous messages. Always the lowest active SID. |
| **Ambiguous message** | An operator message with no reply context — impossible to auto-route. |
| **Targeted message** | A reply to a specific bot message — auto-routed to the owning session. |
| **Rank** | SID order. SID 1 outranks SID 2. Rank determines governor and cascade priority. |

---

## The Human Experience

The operator should never think about routing. They send messages and get
responses. The system handles the rest.

### What the operator sees

- **Session join:** A service message: `🤖 Worker has joined.`
- **Message headers:** Every agent message has a `🤖 Name` prefix when 2+ sessions are active. One glance tells you who's talking.
- **Topics:** Agents set topics (e.g. `Refactoring animation state`). Combined with the name header, the operator always knows who is doing what.
- **Reply targeting:** Reply to any agent's message to talk directly to that agent. No governor triage needed — it's a targeted message.
- **New messages (no reply):** The operator just sends normally. The system routes it to the right agent. If the governor can't determine who it's for, it handles it or asks.

### What the operator does NOT see

- The word "governor" or "routing mode"
- Any internal triage decisions
- System DMs between agents
- Routing metadata

---

## Session Lifecycle

### 1 → 2 Sessions (Governor Activation)

When the second session joins:

1. Operator sees an approval request: `🤖 [Name] wants to join. ✓ Approve / ✗ Deny`
2. On approval, the system activates governor mode automatically.
3. SID 1 (the first session) becomes governor — it has the most context.
4. All existing sessions receive a DM: `📢 🤖 [Name] has joined. You'll coordinate incoming messages.`
5. The joining session starts its work.

### 2 → N Sessions

Each new session follows the same approval flow. The governor doesn't change
unless the current governor closes. Rank order is always SID-ascending.

### N → N−1 Sessions (Governor Transfer)

When a session closes:

| Scenario | Behavior |
| --- | --- |
| Non-governor closes | No routing change. Remaining sessions continue. |
| Governor closes, 2+ remain | Lowest remaining SID becomes governor. The new governor receives a DM. |
| Governor closes, 1 remains | Single-session mode restored. Routing resets to `load_balance`. |

### N → 1 Session

The last remaining session receives a DM: `📢 Single-session mode restored.`
All routing overhead disappears. No more message headers.

---

## Message Routing

### Decision Tree

```text
Incoming operator message
│
├─ Has reply_to context?
│  └─ YES → Route to the session that sent the replied-to message (TARGETED)
│
├─ Has callback/reaction target?
│  └─ YES → Route to the session that owns that interaction (TARGETED)
│
└─ No context (AMBIGUOUS)
   │
   ├─ Governor healthy?
   │  └─ YES → Route to governor
   │
   └─ Governor unhealthy?
      └─ Cascade to next-ranked healthy session
```

### Targeted Messages

- Auto-routed. No governor involvement.
- The owning session sees `routing: "targeted"` on the event.
- If the owner session has closed, the message falls back to the governor.

### Ambiguous Messages

- Routed to the governor, tagged with `routing: "ambiguous"`.
- Non-governor sessions do NOT see the message.
- The governor decides:
  1. **Handle it directly** — the message is clearly for the governor's work.
  2. **Route it** — call `action(type: "message/route", message_id, target_sid)` to forward the
     original message to the right session.
  3. **Ask the operator** — if genuinely unclear, ask who they meant.
- The governor should NEVER silently discard an ambiguous message.

---

## Governor Protocol

The governor is not a special mode the agent enables — it's a responsibility
assigned by the system. The agent learns it's the governor from the
`session_orientation` service message, which includes `governor_sid`.

### Governor Duties

1. **Triage ambiguous messages.** When `routing: "ambiguous"` appears, evaluate
   the message content against what each session is working on (via topics and
   context) and either handle or route.

2. **Coordinate sessions.** Use `send(type: "dm")` to give instructions or
   ask for status from other sessions.

3. **Set a topic.** The governor's topic should reflect its coordinating role
   (e.g. `Overseeing v4 multi-session`) so the operator has context.

4. **Stay responsive.** The governor is the bottleneck for ambiguous messages.
   Long-running tasks should be delegated to worker sessions.

### Governor Decision-Making

When an ambiguous message arrives, the governor should consider:

- **Topic match:** Does the message content match another session's topic?
- **Recency:** Was another session recently discussing this subject?
- **Explicit mention:** Did the operator name a session or task?
- **Default:** If no clear match, handle it. The governor is the fallback owner.

### Tools Available

| Tool | Purpose |
| --- | --- |
| `action(type: "message/route", message_id, target_sid)` | Forward the original operator message to another session's queue |
| `send(type: "dm", target_sid, text)` | Send a private synthetic message to another session |
| `action(type: "session/list")` | See all active sessions, names, and topics |

---

## Governor Failure & Cascade Fallback

If the governor stops polling (crash, timeout, network loss), messages must not
pile up unanswered. The system detects this via heartbeat tracking.

### Heartbeat

Every `dequeue` call records a timestamp on the session. This is the
heartbeat. A session that hasn't polled within the timeout threshold is marked
unhealthy.

### Cascade Behavior

When the governor is unhealthy:

1. New ambiguous messages cascade to the next-ranked healthy session (next lowest
   SID).
2. The fallback session receives a DM: `⚠️ [Governor] appears offline. You're
   handling ambiguous messages.`
3. The operator receives a notification: `⚠️ [Governor] appears unresponsive.`

### Recovery

When the governor resumes polling:

- It's automatically marked healthy and resumes governor duties.
- Messages that were handled by the fallback stay with the fallback.
- No notification needed — the recovery is seamless.

### No Auto-Close

Unhealthy sessions are never auto-closed. Only the operator or overseer decides
whether to close a session. The session may recover.

---

## Agent Guidelines

### On Session Start

1. **Set a descriptive name** — not "Assistant" or "Agent". Use a role name
   like "Worker", "Reviewer", "Overseer".
2. **Set a topic immediately** — e.g. `Refactoring animation state`. This helps
   the governor route messages and helps the operator understand what each agent
   is doing.
3. **Check `fellow_sessions`** — know who else is active and what they're doing.

### During Multi-Session

- **Don't duplicate work.** Check what other sessions are doing before starting a
  task.
- **Respond to DMs promptly.** The governor may ask for status or route a message
  to you.
- **Keep your topic current.** If your work changes, update the topic.

### If You Become Governor Unexpectedly

If the previous governor closed and you're promoted:

1. You'll receive a DM notification.
2. Start monitoring for `routing: "ambiguous"` on your dequeued messages.
3. Review `action(type: "session/list")` to understand what each remaining session is doing.
4. Continue your own work while triaging ambiguous messages.

---

## Message Routing Log (Future)

> **Not yet implemented.** This section describes a planned enhancement.

Each routed message could carry a routing context log — a trail of where it's
been:

```json
{
  "routing_log": [
    { "action": "received", "by": 1, "at": "2026-03-17T10:00:00Z" },
    { "action": "routed", "from": 1, "to": 2, "at": "2026-03-17T10:00:05Z" }
  ]
}
```

This would help agents understand if a message has already been triaged, and
prevent routing loops. For now, messages are simply forwarded without history.
