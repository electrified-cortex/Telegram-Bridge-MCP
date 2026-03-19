# Multi-Session — What's Next

> **⚠️ SUPERSEDED** — Planning companion to the original brainstorming doc. References
> load-balance, cascade, and pass\_message which have been removed. Current task tracking
> lives in `tasks/`.
>
> Handoff / planning companion to [multi-session.md](multi-session.md).
> Tracks open discussions, next actions, and implementation readiness.

## Open Design Discussions

These topics came up during brainstorming but need deeper exploration before implementation.

### ~~Conflict Resolution~~ → Resolved: Cascade Routing Model

See [multi-session.md](multi-session.md) § *Ambiguity Resolution Protocol*. Three routing modes (load balance, ordered cascade, governor). Operator picks the mode when the second session connects. Cascade favors idle sessions, governor delegates all ambiguous messages.

### Session Discovery

When a new session starts, how does it learn what's already happening?

- `session_start` response includes `sessions_active` count
- When `sessions_active > 1`, `session_start` also returns `fellow_sessions` (list of other sessions with SID, name, createdAt) and `routing_mode` ✅
- `list_sessions` tool — enumerate active sessions at any time ✅
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
- [x] **Session store design** — `Map<number, Session>` in session-manager.ts with SID, PIN, name, createdAt
- [x] **Session closure** — `close_session(sid)` removes from active list, cleans up ownership, resets active session if closing the active one
- [x] **Auth middleware pattern** — per-tool `checkAuth(sid, pin)` via SESSION_AUTH_SCHEMA; bootstrap tools exempt
- [x] **Message store metadata** — `TimelineEvent.sid` tags outbound messages with session ID
- [x] **Tool parameter injection** — `sid`/`pin` added to all non-bootstrap tool schemas via `SESSION_AUTH_SCHEMA` ✅
- [x] **DM queue design** — ~~how silent DMs are stored and delivered alongside regular dequeue events~~ ✅ synthetic `direct_message` events injected directly into target session queue
- [x] **Routing mode events** — three modes implemented: load_balance (round-robin), cascade (priority), governor (designated)
- [ ] **Test strategy** — multi-session tests need simulated concurrent tool calls; plan the test harness

## Implementation Order

Based on the phased plan in [multi-session.md](multi-session.md), here's a more granular breakdown.

### Phase 1: Session Manager & Auth (Foundation) ✅

1. ~~Add session counter and PIN generator to server state~~ ✅
2. ~~Modify `session_start` to return `{ sid, pin, sessions_active }`~~ ✅
3. ~~Add `sid`/`pin` parameters to all non-bootstrap tool schemas~~ ✅ (SESSION_AUTH_SCHEMA)
4. ~~Add auth validation wrapper that checks `sid`/`pin` on every tool call~~ ✅ (checkAuth)
5. ~~Tag outbound messages in the store with the calling session's ID~~ ✅ (TimelineEvent.sid)
6. ~~`close_session(sid)` — remove from active tree, adjust cascades~~ ✅
7. ~~Write tests for session creation, auth validation, PIN isolation, session closure~~ ✅

### Phase 2: Per-Session Queues & Routing ✅

1. ~~Split the current single dequeue queue into per-session queues~~ ✅ (TwoLaneQueue per session)
2. ~~Implement inbound routing: reply-based → owning session only~~ ✅
3. ~~Routing mode selection: `/routing` command with inline panel~~ ✅
4. ~~Load balance: round-robin among idle sessions~~ ✅
5. ~~Cascade: lowest-SID idle session first (priority hierarchy)~~ ✅
6. ~~Governor: route to designated governor session~~ ✅
7. ~~Implement cross-session outbound forwarding~~ ✅ (broadcastOutbound)
8. ~~Active-session tracking via setActiveSession/getActiveSession~~ ✅
9. ~~Write tests for routing correctness (each mode, reply routing)~~ ✅
10. ~~`list_sessions` tool — enumerate active sessions~~ ✅

### Phase 3: Direct Messages & Permissions ✅

1. ~~`dm-permissions.ts` — directional permission map (sender→target, operator-gated)~~ ✅
2. ~~`send_direct_message(target_sid, text)` tool with auth + permission check~~ ✅
3. ~~`request_dm_access` → operator `confirm` → grants one-way permission~~ ✅
4. ~~`deliverDirectMessage` in session-queue — inject synthetic event into target queue~~ ✅
5. ~~`close_session` revokes all DM permissions for the closed session~~ ✅
6. ~~Write tests for DM delivery, permission flow, access request~~ ✅

> **Muting deferred** — the permission model handles isolation: no permission = no communication. Muting may layer on later if needed.

### Phase 4: Ambiguity Refinement & Swarm ✅

1. ~~`pass_message` tool for cascade protocol — session forwards ambiguous message to next in SID order~~ ✅
2. ~~`route_message` tool for governor delegation — governor routes message to specific target session~~ ✅
3. ~~Governor death recovery: reset routing mode to load_balance and notify operator when governor closes~~ ✅
4. ~~Cascade timeout tuning — 15 s for idle sessions, 30 s for busy; surfaced as `pass_by` ISO timestamp on dequeued events~~ ✅
5. ~~`list_sessions` tool — enumerate active sessions with names, topics, status~~ ✅ (Phase 2)
6. ~~Session directory for new sessions bootstrapping — `fellow_sessions` + `routing_mode` returned by `session_start` when `sessions_active > 1`~~ ✅
7. ~~Write tests for cascade edge cases (pass, governor death, mode switching)~~ ✅

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
