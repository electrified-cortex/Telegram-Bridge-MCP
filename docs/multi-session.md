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

1. **Zero-cost for single session** — a lone agent works exactly as today. No session ID required. No new parameters. No breaking changes.
2. **Transparent activation** — multi-session "activates" only when a second session connects. The first session is silently assigned a default session ID behind the scenes.
3. **Progressive disclosure** — agents only learn about session IDs when the server tells them. If `session_start` returns a session ID, the agent uses it. If it doesn't, the agent ignores the concept entirely.
4. **The MCP becomes a chat server** — on top of bridging Telegram, it brokers messages between sessions.

## Core Concepts

### Session Identity

Every session has a unique ID, but awareness of it is optional:

- **First session** — becomes the "default." Its session ID is assigned internally but the agent doesn't need to use it explicitly. Everything works as it does today.
- **Second+ sessions** — `session_start` returns a session ID and a message: "there's already an active default session. Here's your ID — include it in your tool calls." The agent guide instructs: if you receive a session ID, carry it.
- The session ID is included in every outbound message's store metadata
- Appears in session record dumps (enabling cross-session conversation replay)
- Is invisible to the Telegram user (cosmetic branding uses `set_topic`)
- Transport-independent — works the same over stdio or HTTP

### Message Routing

When an inbound message arrives from the user, the server must decide which session's queue to place it in.

**Routing signals (in priority order):**

1. **Reply-to routing** — User replies to a message from Session A → routes to Session A only. The store tracks which `message_id` was sent by which session.
2. **Broadcast (default for new messages)** — User sends a new message with no reply context → all sessions receive it. Each session decides whether to act on it based on its role/focus.
3. **Active session override** — User sends `/switch <name>` to designate one session as the sole recipient of non-reply messages (opt-in, not default).

### Outbound Visibility (Cross-Session Awareness)

This is where multi-session gets powerful:

- Messages sent by Session A are **never dequeued back to Session A** (same as today — you don't see your own outbound).
- Messages sent by Session A **are enqueued to all other sessions** — they appear in their dequeue stream tagged with Session A's ID and topic.
- This means sessions are aware of what other sessions are saying to the user.
- Any session can query the timeline to see the full cross-session conversation.
- A session can **mute** another session's outbound (opt out of cross-session updates) to reduce noise.

### Session Lifecycle

- `session_start` with no active sessions → becomes default, ID assigned silently.
- `session_start` with existing sessions → returns explicit session ID + list of active sessions.
- Session disconnect → queue stops accumulating after a configurable timeout. Session marked inactive.
- Session reconnect → can reclaim its session ID if within the timeout window.

### The Swarm Model

With session IDs and cross-session visibility, you get a team dynamic:

- **User as dev manager** — directs work to specific sessions via replies or `/switch`
- **Agent as principal dev** — one session can coordinate others by reading their timeline entries
- **Parallel work** — multiple sessions work independently, each branded with their topic
- **Shared context** — any session can look back at what others said
- **Muting** — a focused session can mute noisy neighbors to concentrate on its task
- **Fake personas** — each session appears as a different "person" in the chat (topic prefix), but they're all the same bot. Like creating virtual team members.

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
| Reply to Session A's message | Session A only | Highest |
| Reaction on Session A's message | Session A only | Highest |
| Callback (button press) on Session A's message | Session A only | Highest |
| `/switch <name>` then new message | Named session only | High |
| New message, no reply context | All sessions (broadcast) | Default |

### Outbound (Sessions → User → Other Sessions)

| Action | User sees | Other sessions see |
| --- | --- | --- |
| Session A sends a message | Message with topic prefix | Dequeue event tagged with Session A's ID |
| Session A sets a reaction | Emoji on the message | Timeline event (queryable) |

### Cross-Session (Session → Session)

| Action | Behavior |
| --- | --- |
| Session A sends outbound | Enqueued to all other sessions (unless muted) |
| Session B mutes Session A | Session B stops receiving Session A's outbound in its queue |
| Any session queries timeline | Sees full cross-session history with session IDs |

## Open Questions

- **Queue isolation vs shared queue?** Each session gets its own dequeue queue, but should there be a "global" feed sessions can opt into?
- **Session lifecycle** — what happens when a session disconnects? Does its queue keep accumulating? Auto-expire after N minutes?
- **Conflict resolution** — two sessions reply to the same user message. Who wins? First responder? Both?
- **Rate limiting** — prevent a runaway session from flooding the chat
- **Session discovery** — how does a new session learn what other sessions exist and what they're working on?
- **Persistence** — should session state survive server restarts? (Timeline is in-memory today)

## Implementation Phases

### Phase 1: Session IDs

- Add session ID generation to `session_start`
- Tag all outbound messages with session ID in the store
- Tag all tool calls with session ID internally
- No transport change yet — groundwork only

### Phase 2: Transport Migration

- Add `StreamableHTTPServerTransport` as an alternative to stdio
- Support both transports (stdio for single-session backward compat, HTTP for multi)
- Each HTTP client gets a session ID on connect

### Phase 3: Message Routing

- Implement reply-based routing on inbound messages
- Add `/switch` command for active session selection
- Per-session dequeue queues
- Cross-session timeline queries

### Phase 4: Swarm Features

- Inter-session messaging (session A can "send" to session B via store)
- Session directory (list active sessions, their topics, their status)
- Coordinator patterns (one session delegates to others)
