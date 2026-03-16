# Multi-Session — What's Next

> Handoff / planning companion to [multi-session.md](multi-session.md).
> Tracks open discussions, next actions, and implementation readiness.

## Open Design Discussions

These topics came up during brainstorming but need deeper exploration before implementation.

### ~~Conflict Resolution~~ → Resolved: Cascade Routing Model

See [multi-session.md](multi-session.md) § *Ambiguity Resolution Protocol*. Three routing modes (load balance, ordered cascade, governor). Operator picks the mode when the second session connects. Cascade favors idle sessions, governor delegates all ambiguous messages.

### Session Discovery

When a new session starts, how does it learn what's already happening?

- `session_start` response includes `sessions_active` count
- A dedicated `list_sessions` tool (Phase 4)
- Timeline scan (expensive, but complete)

### ~~Persistence Across Restarts~~ → Resolved: Ephemeral

In-memory only. Restart invalidates all sessions. Agents must re-call `session_start`. Accepted for v4.

### Rate Limiting Per Session

A runaway session could flood the chat. Design needed for:

- Per-session message rate cap
- Global outbound queue with fair scheduling
- Back-pressure signals to sessions that are sending too fast

### Animation Aggregation UX

The "combined status board" idea: when multiple sessions have active animations, show a single message listing all of them. Needs mockup of what this looks like in Telegram and how it updates.

### Group Chat Implications

The current design assumes a single private chat. Group chat adds:

- Multiple users (not just one operator)
- Per-user muting (not just per-session)
- Thread-based routing vs. reply-based routing

Defer until single-chat multi-session is solid.

## Pre-Implementation Checklist

Things to verify or set up before writing code.

- [x] **Feature flag** — Resolved: no feature flag. v4 always assigns session IDs.
- [x] **Persistence** — Resolved: ephemeral (in-memory only). Restart invalidates all sessions.
- [x] **Reply-to routing** — Resolved: replies are always targeted. Only the owning session gets them. Bidirectional.
- [x] **Auth scope** — Resolved: bootstrap exceptions for `get_me`, `get_agent_guide`, `session_start`. Everything else requires `sid`/`pin`.
- [ ] **Session store design** — define the in-memory data structure (Map of session objects with ID, PIN, name, state, queues, mute config, DM permissions)
- [ ] **Session closure** — `close_session(sid)` removes from active tree, cascade adjusts, governor death triggers mode recovery
- [ ] **Tool parameter injection** — prototype adding `sid`/`pin` to all tool schemas
- [ ] **Auth middleware pattern** — decide where authentication checks live (per-tool, middleware wrapper, or McpServer-level hook)
- [ ] **Message store metadata** — confirm the store can tag messages with session IDs without breaking existing consumers
- [ ] **DM queue design** — how silent DMs are stored and delivered alongside regular dequeue events
- [ ] **Routing mode events** — define the event shape for cascade offers, claim/pass responses, and governor delegation
- [ ] **Test strategy** — multi-session tests need simulated concurrent tool calls; plan the test harness

## Implementation Order

Based on the phased plan in [multi-session.md](multi-session.md), here's a more granular breakdown.

### Phase 1: Session Manager & Auth (Foundation)

1. Add session counter and PIN generator to server state
2. Modify `session_start` to return `{ sid, pin, sessions_active }`
3. Add `sid`/`pin` parameters to all non-bootstrap tool schemas
4. Add auth validation wrapper that checks `sid`/`pin` on every tool call
5. Tag outbound messages in the store with the calling session's ID
6. `close_session(sid)` — remove from active tree, adjust cascades
7. Write tests for session creation, auth validation, PIN isolation, session closure

### Phase 2: Per-Session Queues & Routing

1. Split the current single dequeue queue into per-session queues
2. Implement inbound routing: reply-based → owning session only
3. Routing mode selection: prompt operator on 2nd session connect (load balance / cascade / governor)
4. Load balance: route to first idle session (ascending ID order)
5. Ordered cascade: offer to Session 1 first → claim/pass/timeout → cascade
6. Governor: designate one session as router, auto-grant DM access
7. Implement cross-session outbound forwarding (Session A's send → other sessions' queues, unless muted)
8. Add `/switch` command parsing and active-session tracking
9. Write tests for routing correctness (each mode, reply routing, switch)

### Phase 3: Direct Messages, Permissions & Muting

1. Add DM queue to session objects
2. Implement `send_direct_message(target_sid, text)` tool
3. DM authorization flow: `request_dm_access` → operator `confirm` → channel opens
4. Unidirectional vs bidirectional DM permissions
5. Self-muting (blocklist/allowlist mode)
6. Operator force-unmute override
7. Internal-only control messages (invisible to unrelated sessions)
8. Ensure "targeted messages override mute" rule is enforced
9. Write tests for DM delivery, permission flow, mute edge cases

### Phase 4: Ambiguity Refinement & Swarm

1. `claim_message` / `pass_message` tools for cascade protocol
2. `route_message` tool for governor delegation
3. Governor death recovery: prompt operator for new mode when governor disconnects
4. Cascade timeout tuning (idle vs busy session timeouts)
5. `list_sessions` tool — enumerate active sessions with names, topics, status
6. Session directory for new sessions bootstrapping
7. Write tests for cascade edge cases (all pass, governor death, mode switching)

## Quick Wins (Can Do Now)

These don't require the full multi-session system and could be implemented independently:

- **Session ID in `session_start` response** — start returning an ID even in single-session mode. No behavioral change, just future-proofing the API shape.
- **Outbound message tagging in store** — tag messages with a session identifier in metadata. Single-session always tags as session 1.
- **Reaction priority concept** — the priority-based reaction API is useful even without multi-session (e.g., distinguishing between acknowledgment reactions and important reactions).
- **Timeline size config guidance** — recommend 100+ for multi-session deployments versus the current default.

## Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| PIN leaks into Telegram messages or logs | Session impersonation | Strict never-log-PIN rule; audit all serialization paths |
| Queue memory growth with many sessions | OOM | Cap max sessions; bounded queue sizes per session |
| Interleaved agent output confuses user | Bad UX | Topic prefixes; animation aggregation; per-session rate limits |
| Breaking change to tool schemas (adding sid/pin) | Existing agents break | v4 is a major version; session params are always required |
| Telegram rate limit hit with multiple sessions | Messages dropped/delayed | Global rate limiter shared across all sessions |
