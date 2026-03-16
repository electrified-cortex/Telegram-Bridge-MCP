# Multi-Session Communication

> Working document — brainstorming and design notes for multi-session / multi-agent communication through a single Telegram Bridge MCP instance.

## Critical Constraint: One MCP Instance Per Bot Token

**Only one Telegram Bridge MCP process may run per bot token.** This is a hard Telegram API limitation:

- `getUpdates` (long polling) only supports one consumer per bot token. A second process calling `getUpdates` will steal updates from the first, causing lost messages, duplicate processing, and unpredictable behavior.
- Running two separate MCP instances with the same bot token **will break both**.
- The multi-session model solves this by running one MCP process that serves multiple agent sessions internally — NOT by running multiple MCP processes.

Documentation must emphasize this clearly: if you want multiple agents, connect them to the **same** MCP instance (via HTTP transport), don't spawn separate instances with the same token.

## Problem Statement

Today, Telegram Bridge MCP is strictly single-session: one stdio transport, one agent client, one message queue. If you want two agents working in parallel (e.g., two VS Code windows), you need two separate bot tokens — which is impractical.

The goal: enable multiple agent sessions to share a single bot and Telegram chat, with clear routing so messages reach the right session and don't cause confusion.

## Why It's Now Possible

The message store changed everything. Before, messages were fire-and-forget — no history, no metadata, no way to look back. Now:

- **Rolling timeline** of up to 1000 events with full metadata
- **Message index** mapping `message_id` → version history
- **Outbound tracking** — bot messages are indexed with sender context
- **Session recording** — full conversation export

Since we control the store, we can attach arbitrary metadata (session IDs, ownership tags) to every message — even though Telegram's API doesn't support custom metadata natively.

## Design Principles

1. **One API, always a session** — `session_start` is always the first call, period. Every agent, every time, gets a session ID and PIN. No special "single-session mode."
2. **Self-describing session count** — the session ID is an incrementing integer. If you're session 1, you're alone. If you're session 3, there are at least 3 sessions active.
3. **Always-on** — v4 always assigns session IDs. There is no feature flag or opt-in toggle. Single-session is simply "only one agent connected." The routing, auth, and session identity infrastructure is always present.
4. **Default isolation** — sessions are completely invisible to each other until explicitly authorized. No inter-session communication exists by default. Each session operates as if it's the only one, until the operator grants permissions.
5. **The MCP becomes a chat server** — on top of bridging Telegram, it brokers messages between sessions.

## Core Concepts

### Session Start as a Cursor

`session_start` marks a point in the message timeline: "everything from here forward is what this session cares about." Previous messages in the stream — including those from other sessions — are irrelevant to the new session.

### Session Identity & Authentication

Every session has three identifiers:

- **Session ID (`sid`)** — server-generated, incrementing integer (1, 2, 3...). Public — appears in timeline metadata, visible to other sessions. Self-describing: if your ID is 1, you're the only session.
- **Session PIN (`pin`)** — server-generated, 6-digit numeric code. Private — returned only to the session that called `session_start`. Never exposed in messages, timeline, or session record dumps. Required alongside the session ID on all tool calls as proof of ownership.
- **Session name** — optional, human-friendly, used as the topic prefix in Telegram messages. Provided by the agent at `session_start`. Cosmetic only. Encouraged when `session_id > 1`.

This two-factor model prevents impersonation:

- Session B can see Session A's ID in the timeline (for cross-session awareness)
- Session B cannot forge tool calls as Session A because it doesn't know Session A's PIN
- The PIN is naturally isolated by each agent's context window — one conversation can't see another's context
- PINs must NEVER leak into Telegram messages, timeline events, or session record dumps
- On MCP restart, counter resets and new PINs are generated — old credentials are automatically invalidated

### Tool Call Authentication

**Session-management tools require `sid` and `pin`** — both as integer parameters. These include `close_session`, `send_direct_message`, `pass_message`, `route_message`, and `request_dm_access`. Other tools rely on the active session context set by `session_start` and do not require explicit auth parameters.

Parameter design for token efficiency:

- **`sid`** — integer (1, 2, 3...). One token.
- **`pin`** — integer (6-digit code). One token.
- Short parameter names minimize token cost. ~2 tokens overhead per authenticated tool call.
- Invalid or missing `sid`/`pin` on auth-required tools → server rejects with an auth error.

`session_start` response example:

```json
{ "sid": 3, "pin": 719304, "sessions_active": 3 }
```

Agent guide instructs: "If `sid > 1`, call `set_topic` before doing anything else."

### Message Routing

When an inbound message arrives from the user, the server must decide which session's queue to place it in.

**Targeted messages (deterministic — always routed):**

1. **Reply-to routing** — User replies to a message from Session A → routes to Session A only. The store tracks which `message_id` was sent by which session. Replies are always targeted and hidden from other sessions.
2. **Callback routing** — Button press on Session A's message → routes to Session A only.
3. **Reaction routing** — Reaction on Session A's message → routes to Session A only.

**Ambiguous messages (no reply context):**

New messages with no reply context are "ambiguous" — the server doesn't know who they're for. These are handled by the active **routing mode** (see [Ambiguity Resolution Protocol](#ambiguity-resolution-protocol)).

**At-session targeting:**

Agents can direct messages to specific sessions using `@session:<sid>` syntax in internal tools (not Telegram messages). This enables inter-session communication when authorized.

### Outbound Visibility (Cross-Session Awareness)

This is where multi-session gets powerful:

- Messages sent by Session A are **never dequeued back to Session A** (same as today — you don't see your own outbound).
- Messages sent by Session A **are enqueued to all other sessions** — they appear in their dequeue stream tagged with Session A's ID and topic.
- This means sessions are aware of what other sessions are saying to the user.
- Any session can query the timeline to see the full cross-session conversation.
- A session can **mute** another session's outbound (opt out of cross-session updates) to reduce noise.

### Session Lifecycle

- `session_start` with no active sessions → becomes session 1. Routing mode selection is skipped (irrelevant with one session).
- `session_start` with existing sessions → returns explicit session ID, PIN, active session count. Operator is prompted to select a routing mode (if not already set).
- **Session closure** — `close_session(sid)` tool. Drains the session's queue, removes it from the active session list, and cleans up resources. If the closed session was the governor, governor mode is dropped and the operator is prompted to select a new routing mode.
- **Transport disconnect** — queue stops accumulating after a configurable timeout. Session marked inactive but not closed (can reconnect and reclaim).
- **Session reconnect** — *(not yet implemented)* reserved for future: reclaim SID within a timeout window if PIN matches.
- **MCP restart** — all sessions are invalidated (ephemeral, in-memory only). Agents must call `session_start` again to get new credentials.

### The Swarm Model

With session IDs and cross-session visibility, you get a team dynamic:

- **User as dev manager** — directs work to specific sessions via replies or `/switch`
- **Agent as principal dev** — one session can coordinate others by reading their timeline entries
- **Parallel work** — multiple sessions work independently, each branded with their topic
- **Shared context** — any session can look back at what others said
- **Muting** — *(deferred)* a focused session could mute noisy neighbors; currently handled by the permission model (no DM permission = no communication)
- **Fake personas** — each session appears as a different "person" in the chat (topic prefix), but they're all the same bot. Like creating virtual team members.

## Muting (Deferred)

> **Status:** Deferred. The DM permission model handles session isolation — no permission means no communication. Explicit muting may be added later if the cross-session outbound broadcast becomes noisy in practice.

Original design notes preserved for reference:

### Session Muting

Sessions can mute other sessions to reduce cross-session noise in their dequeue stream:

- **Blocklist model** — by default, all cross-session outbound is visible. A session can mute specific other sessions.
- **Allowlist model** — alternatively, a session can declare "only show me messages from session X."
- Muting is per-session and unilateral — no permission needed from the muted session.
- Mute config is set via tool call (`mute_session`, `unmute_session`).

### User Muting

A session can block all operator messages (e.g., a background worker that only responds to inter-session DMs):

- Must be explicitly enabled by the operator via `confirm` before taking effect.
- A muted-user session still receives targeted replies (reply-to routing overrides muting).

### Muting Rules

- Targeted messages (reply-to) **always** override mute settings — if the operator replies to your message, you get it regardless.
- Muting only affects the dequeue stream. Timeline queries always return the full history.
- Muting state is per-session, ephemeral, and resets on MCP restart.

## Resolved Decisions

Design questions that were discussed and locked in:

| Decision | Resolution | Rationale |
| --- | --- | --- |
| Feature flag | **Always-on** — v4 always assigns session IDs | No opt-in toggle. Single-session is just "only one agent connected." |
| Auth scope | **Bootstrap exceptions** — `get_me`, `get_agent_guide`, `session_start` skip auth | These tools are needed before a session exists. Everything else requires `sid`+`pin`. |
| Persistence | **Ephemeral** — sessions are in-memory only | No disk persistence. MCP restart = clean slate. Matches the existing message store model. |
| Reply-to routing | **Always targeted and bidirectional** | Replies are ALWAYS routed to the owning session and hidden from others. Other sessions never see reply-targeted messages in their dequeue stream. |
| Operator visibility | **Operator sees everything** | All messages from all sessions appear in the Telegram chat. The operator is always the full audience — sessions cannot hide messages from the operator. |

## Ambiguity Resolution Protocol

When a message arrives with no reply context (ambiguous), the server consults the active **routing mode** to decide where it goes. The operator selects a routing mode when the second session connects.

### Routing Modes

#### 1. Load Balance

The simplest mode. Ambiguous messages are distributed via **round-robin** among idle sessions (those currently blocked on `dequeue_update`). If no sessions are idle, round-robin continues among all sessions.

- No claim/pass ceremony — instant routing.
- Good for: homogeneous workers doing the same type of task.
- Drawback: no intelligence about which session is best suited.

#### 2. Ordered Cascade

Messages are offered to sessions one at a time, in priority order. Each session can **claim** (keep it) or **pass** (forward it to the next).

**Routing:**

1. Server selects the lowest-SID idle session (one blocked on `dequeue_update`). If no idle sessions exist, picks the lowest SID overall.
2. The selected session receives the message in its dequeue stream with a `pass_by` ISO timestamp — the deadline to act:
   - **Idle sessions:** 15 seconds from delivery.
   - **Busy sessions:** 30 seconds from delivery.
3. The session either claims the message (simply handles it) or calls `pass_message(message_id)` to forward it to the next session in SID order.
4. **Last session in the queue MUST claim** — `pass_message` returns an error if called by the last session. This guarantees every message is handled.
5. The deadline is advisory — the server does not forcibly re-route an unclaimed message after expiry; the deadline is guidance for the agent.

**Dequeued event shape (cascade mode):**

```json
{
  "id": 12345,
  "event": "message",
  "from": "user",
  "content": { "type": "text", "text": "Can you check the deploy logs?" },
  "pass_by": "2026-03-16T11:45:00.000Z"
}
```

- Good for: heterogeneous sessions with different specializations.
- The cascade order ensures the most available session gets first dibs.

#### 3. Governor

One session is designated as the **governor**. All ambiguous messages go to the governor first, and the governor decides which session should handle each one.

- Governor sees a classification prompt with the message text and list of active sessions + their names/topics.
- Governor responds with a routing decision (target session ID).
- If the governor is unavailable (disconnected, timed out), falls back to ordered cascade.
- Governor death recovery: operator is prompted to select a new routing mode.

See [Governor Pattern](#governor-pattern) for scope and constraints.

### Routing Mode Selection

- When the second session connects, the operator is prompted: "Multiple sessions active. How should ambiguous messages be routed?" with three button options.
- The operator can change the routing mode at any time via the `/routing` command, which opens an inline panel showing the current mode and buttons to switch.
- If the operator doesn't respond, the default is **load balance** (simplest, safest).
- Mode selection is stored in-memory and resets on MCP restart.

### Three Routing Scenarios

| Scenario | Load Balance | Ordered Cascade | Governor |
| --- | --- | --- | --- |
| User says "check the logs" (no reply) | Routes to first idle session | Offers to session 1, then 2, then 3... | Governor classifies and delegates |
| User replies to Session 2's message | Routes to Session 2 (targeted) | Routes to Session 2 (targeted) | Routes to Session 2 (targeted) |
| User presses button on Session 1's msg | Routes to Session 1 (targeted) | Routes to Session 1 (targeted) | Routes to Session 1 (targeted) |

Targeted messages bypass the routing mode entirely — they always go to the owning session.

### Governor Pattern

The governor is a session with a **narrow, well-defined scope**: routing ambiguous messages.

### What the Governor Does

- Receives every ambiguous message (no reply context).
- Sees: message text, list of active sessions (ID, name, topic, idle/busy status).
- Decides: which session ID should handle this message.
- Responds with a routing decision. The server delivers the message to that session.

### What the Governor Does NOT Do

- **Not a task coordinator** — does not assign work, track progress, or manage session lifecycles.
- **Not an orchestrator** — does not issue commands to other sessions.
- **Not a supervisor** — does not monitor session output or intervene in their work.
- The governor is a **classifier**, not a **manager**. It answers one question: "who should handle this?"

### Governor as Conflict Resolver

If two sessions both want to respond to the same ambiguous message (race condition in cascade mode), the governor can serve as a tiebreaker. But this is an edge case — the cascade model's sequential offer prevents most conflicts.

### Governor Context

The governor's agent guide should include:

- List of active sessions with their declared focus/topic
- Instructions to route based on topic relevance
- Fallback: if unsure, route to the lowest-ID idle session (same as load balance)

## Direct Messages (Inter-Session Communication)

By default, sessions have **zero awareness** of each other. DMs must be explicitly authorized.

### How DMs Work

- A session calls `send_dm(target_sid, text)` to send a message to another session.
- The target session receives the DM in its dequeue stream, tagged with the sender's session ID.
- DMs are internal-only — they never appear in the Telegram chat. The operator does not see them (unless viewing session records).

### DM Authorization

DM capability requires explicit operator approval:

1. Session A calls `request_dm(target_sid)`.
2. The operator receives a `confirm` prompt: "Session A wants to send DMs to Session B. Allow?"
3. On approval, the server records the permission. On denial, the request is rejected.
4. Permissions are directional: A→B does not imply B→A. Each direction requires separate approval.

### DM Types

| Type | Description | Use Case |
| --- | --- | --- |
| **Listening** | One-way: A can send to B, but B cannot reply | Status updates, notifications |
| **Bidirectional** | Both directions authorized | Collaboration, coordination |
| **Broadcast** | One session can send to all others | Announcements, governor directives |

### Silent DMs

A DM can be marked `silent: true` — the receiving session gets it in its dequeue stream but with no notification or typing indicator. Useful for background telemetry or status pings that shouldn't interrupt focused work.

## Permissions Model

Three axes of control, all operator-mediated:

### 1. Inbound Muting

Controls what a session sees in its dequeue stream. See [Muting (Deferred)](#muting-deferred).

### 2. DM Authorization

Controls which sessions can communicate directly. See [Direct Messages](#direct-messages-inter-session-communication).

### 3. Internal-Only Controls

Some capabilities are restricted to specific sessions:

- **Governor designation** — only one session can be governor at a time. Set by operator.
- **Session closure** — a session can close itself, but closing another session requires operator confirmation.
- **Mute override** — the operator can force-unmute a session that muted the user (safety valve).

All permission changes require operator confirmation via `confirm` prompts. No session can unilaterally grant itself permissions.

## Concurrency Challenges

### Typing Indicator

Today, `show_typing` is a simple boolean. With multiple sessions:

- Multiple sessions may be "typing" simultaneously.
- The Telegram API only supports one typing indicator per chat — it's not per-session.
- Solution: **Reference counting.** The server tracks how many sessions are typing. `sendChatAction("typing")` is sent when count goes from 0→1. The action stops when count returns to 0 (or Telegram's 5-second auto-timeout expires).

### Per-Session Animations

Animation state is currently global (one animation at a time). With multiple sessions:

- Each session needs its own animation state.
- The server must multiplex: show the most important animation, or cycle between them.
- Alternative: animations are per-session metadata only, and the Telegram indicator uses the typing ref-count approach.

### Message Ordering

When two sessions send messages simultaneously:

- Telegram delivers them in API-call order (whoever's HTTP request arrives first).
- The server should not try to enforce ordering — Telegram's natural ordering is sufficient.
- The message store records timestamps for auditability.

### Reaction Conflicts

Two sessions set different reactions on the same message:

- Telegram only supports one bot reaction per message.
- The last API call wins.
- The server should track which session "owns" a reaction and warn if another session tries to override it.
- Potential: priority-based system where higher-priority sessions win reaction conflicts.

### Button/Callback Routing

Inline keyboard callbacks include a `callback_query` with the message ID:

- The server knows which session sent the message (from store metadata).
- Callbacks are always routed to the originating session.
- No ambiguity — this is deterministic routing.

### Telegram Rate Limits

- Telegram enforces ~30 messages/second per bot, ~20 messages/minute per chat.
- With multiple sessions sending simultaneously, rate limits become a real concern.
- The outbound proxy should enforce per-chat rate limiting with a shared queue.
- Sessions that exceed the rate limit get their sends delayed, not rejected.

## Transport Considerations

### stdio (backward compat, single-session)

Works exactly as today. The server assigns a default session ID internally, but the agent never sees it. No changes needed.

### StreamableHTTPServerTransport (multi-session)

- Multiple clients connect over HTTP, each gets its own transport-level session
- The MCP server maps transport sessions to application-level session IDs
- If a transport session reconnects, it can reclaim its application-level session
- The transport session ID and our session ID are separate — transport is the pipe, our ID is the identity

## Routing Rules (Detailed)

### Inbound (User → Sessions)

| Signal | Target | Priority |
| --- | --- | --- |
| Reply to Session A's message | Session A only | Highest (deterministic) |
| Reaction on Session A's message | Session A only | Highest (deterministic) |
| Callback (button press) on Session A's message | Session A only | Highest (deterministic) |
| New message, no reply context | Routing mode decides | Ambiguous |

### Outbound (Sessions → User → Other Sessions)

| Action | User sees | Other sessions see |
| --- | --- | --- |
| Session A sends a message | Message with topic prefix | Dequeue event tagged with Session A's ID (unless muted) |
| Session A sets a reaction | Emoji on the message | Timeline event (queryable, not dequeued) |

### Cross-Session (Session → Session)

| Action | Behavior |
| --- | --- |
| Session A sends outbound | Enqueued to all other sessions (unless muted) |
| Session A sends a DM to Session B | Delivered to Session B's dequeue stream only (requires DM auth) |
| Session B mutes Session A | Session B stops receiving Session A's outbound in its queue |
| Any session queries timeline | Sees full cross-session history with session IDs |

## Timeline Size

For multi-session, the recommended timeline size is **100+ messages** (up from the default). With multiple sessions producing output, the timeline fills faster. A larger window ensures sessions can see enough cross-session context when querying history.

## Open Questions

- **Rate limiting** — how to fairly distribute Telegram's per-chat rate limit across sessions. Per-session quotas? Shared pool with backpressure?
- **Session discovery** — how does a new session learn what other sessions exist and what they're working on? `list_sessions` tool returning names/topics/status?
- **Stale session cleanup** — auto-expire after N minutes of inactivity? Configurable timeout?
- **Animation aggregation** — how to display multiple concurrent animations. Cycle? Priority? Per-session indicator text?
- **Group chat compatibility** — multi-session in group chats adds another dimension (multiple chats × multiple sessions). Defer to post-v4?
- **Session limits** — maximum concurrent sessions? Memory/performance bounds?
- **DM abuse prevention** — rate limiting on inter-session DMs to prevent spam loops?

## Implementation Phases

### Phase 1: Session Manager & Auth

- Session ID generation (incrementing integer) and PIN generation (6-digit random).
- In-memory session store: `Map<sid, { pin, name, state, queue, muteConfig, dmPermissions }>`.
- `session_start` returns `{ sid, pin, sessions_active }`.
- Auth middleware: validate `sid`+`pin` on all non-bootstrap tool calls.
- `close_session(sid)` tool with queue drain and cleanup.
- Message tagging: all outbound messages tagged with `sid` in store metadata.
- **TDD approach** — write tests first for session creation, PIN validation, auth rejection, session closure.

### Phase 2: Queues & Routing Modes

- Per-session dequeue queues.
- Inbound routing: reply-to → deterministic, no reply → routing mode.
- Implement all three routing modes: load balance, ordered cascade, governor.
- `ambiguous_offer` event type for cascade mode.
- `claim` and `pass` tools for cascade responses.
- Routing mode selection prompt on second session connect.
- Routing mode change command.

### Phase 3: DMs & Permissions

- `send_dm(target_sid, text)` tool.
- `request_dm(target_sid)` → operator `confirm` flow.
- DM authorization store (directional permission map).
- Session muting tools: `mute_session`, `unmute_session`.
- Muting override rules (targeted messages always delivered).

### Phase 4: Cascade Refinement & Swarm

- Cascade timeout tuning and monitoring.
- Governor context enrichment (session status, topic summaries).
- Governor death recovery and fallback.
- Session directory tool (`list_sessions`).
- Cross-session timeline query enhancements.
- Performance testing with 5+ concurrent sessions.
