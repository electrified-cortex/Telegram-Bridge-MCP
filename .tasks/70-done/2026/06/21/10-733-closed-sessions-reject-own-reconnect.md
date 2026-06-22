---
id: "10-733"
created: 2026-04-19
updated: 2026-06-21
status: needs-refinement
priority: 10
repo: electrified-cortex/Telegram-Bridge-MCP
type: Bug
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
branch: dev
dispatch_ready: true
needs_operator: false
blocked_on: ""
---

# 10-733 - Closed sessions must reject their own reconnect tickets

## Context

Observed 2026-04-19 (msgs 38452-38453): after Curator closed Worker 1 (SID 3), the same OS process reconnected and came back as SID 7 via a fresh reconnect ticket that the operator approved. This defeats the purpose of closing a session - the zombie process acquired a new identity and kept running.

Operator ruling: a session that was closed (or force-closed) must not be able to grant its caller a new identity via reconnect. The close action must be terminal for that caller.

## Acceptance Criteria

1. [x] When any session is closed via `closeSessionById()` (self-close, governor-close, force-close), record a `ClosedSessionMarker` keyed by the session's `connectionToken` in `_closedMarkers` (in `session-manager.ts`). TTL defaults to 24 h via `CLOSED_SESSION_MARKER_TTL_MS` env var.
2. [x] `handleSessionReconnect()` accepts an optional `connection_token` parameter. When provided, it looks up `_closedMarkers` before the operator approval dialog. If a marker exists, return `toError({ code: "CALLER_CLOSED", ... })` immediately — the operator dialog is never shown.
3. [x] `handleSessionStart()` with `refresh: true` accepts an optional `connection_token` parameter. Same lookup and rejection before approval dialog.
4. [x] A zombie caller that does NOT present a `connection_token` still reaches the operator approval dialog (operator is the backstop). The token is optional to preserve legitimate new-process behavior.
5. [x] Operator can unblock a marker via `action(type: 'session/unblock', connection_token: <token>)`. This calls `clearClosedMarker(connectionToken)`.
6. [x] Expired markers (`expiresAt < Date.now()`) are swept on read (lazy) and by a `sweepExpiredMarkers()` call scheduled every 10 minutes in `index.ts`.
7. [x] When a marker is recorded at close time, a service message is delivered to the current governor containing the closed `connectionToken` (with a note that it must not be posted to Telegram) so the operator has the handle for unblocking.
8. [x] Regression test: `createSession()` → `closeSessionById()` → `handleSessionReconnect()` with the saved `connectionToken` → assert `CALLER_CLOSED` error code.

## Verification

APPROVED by verifier a93cb11ad828c51f7 — all 8 ACs confirmed, 3628 passed / 0 failed, clean worktree.

## Constraints

- Legitimate re-spawn (operator-initiated, new process) must not be blocked. Anti-affinity is keyed on `connectionToken`, which only the closed process holds. A new process has no prior token and is never blocked.
- **Caller identity is `connectionToken`** (UUID from `Session.connectionToken`). Session name alone is insufficient (name can be collide); SID alone is insufficient (monotonically increments). The UUID is the right discriminator — it is already stored, already returned in `session/start` responses, and is process-private.
- `connection_token` is optional in both reconnect paths. Absent-token callers are not pre-blocked; the operator dialog remains the backstop. This is a deliberate trade-off to avoid blocking legitimate new processes that lack a prior token.
- Changes to the reconnect flow are security-sensitive. The anti-affinity check must occur before `requestReconnectApproval()` and before `requestApproval()` to ensure the operator is never shown a dialog for a zombie caller.
- Do not store markers on disk. In-memory TTL is sufficient; process restart is a legitimate new process.
- Do not add HTTP-layer fingerprinting. TMCP callers are localhost stdio processes with no distinguishable network identity.

## Priority

10 - bug, depth-4 (architecture). Zombie reconnect is a real security / fleet-hygiene issue.

## Delegation

Worker (TMCP) after design review. Curator should spec this before worker claims.

## Related

- Memory `feedback_session_close_vs_shutdown.md`.
- Memory `feedback_no_worker1_this_session.md` (the symptom we're treating).
- 10-732 (false back-online after close - adjacent close-path work).

## Overseer bounce (2026-06-20)
- verdict: NEEDS CURATOR DESIGN SPEC
- finding: AC1 requires "caller identity" definition — concretely: what constitutes a fingerprint? Process token hash? Name? Something in the HTTP headers? This is an architectural/security decision, not a worker decision. The spec itself says "Caller identity needs a concrete definition" and "Curator should spec this before worker claims."
- action: Curator must design the anti-affinity mechanism (what is caller identity, where is the marker stored, what is the unblock API) before this can be promoted to 40-queued. Once Curator provides the design, worker can implement.

## Implementation Design (2026-06-21, Curator)

### Background: how session tokens work today

Every session carries a `connectionToken` (a `randomUUID()` assigned at `createSession()`). This token is returned to the caller in the `session/start` response alongside the numeric composite `token` (`sid * 1_000_000 + suffix`). The `connectionToken` was originally added for duplicate-session detection (Option A in `session-manager.ts` comments). It is the right primitive to anchor anti-affinity on.

Key code paths:
- `src/session-manager.ts` — `createSession()`, `closeSession()`, `checkConnectionToken()`
- `src/session-teardown.ts` — `closeSessionById()` — only teardown path (used by close tool, governor panel, force-close after signal timeout)
- `src/tools/session/start.ts` — `handleSessionStart()` (new session + `refresh:true` reuse), `handleSessionReconnect()` (lost-token path)

### 1. Caller identity definition

**The caller identity is the `connectionToken` (UUID) held by the caller.**

Rationale:
- The `connectionToken` is already assigned at session creation and already stored on `Session`. It is a per-session secret; the server knows it and the caller (who saved `memory/telegram/session.token` and the `connectionToken`) knows it.
- Session name alone is insufficient: a different process can spin up with the same name. SID alone is insufficient: SIDs increment monotonically and a fresh start picks a new one.
- The `connectionToken` is process-private. When a session is closed, the process that held it is the only one who knows it — and that is exactly the entity we want to block.
- We do NOT use HTTP-header fingerprints (user-agent, IP) because TMCP callers are localhost stdio processes; there is no distinguishable network identity.

**Reconnect caller identification flow:**
- On `session/reconnect`, the caller passes the session `name`. The bridge already resolves `name → SID`. To assert anti-affinity, the caller **must** also present their `connectionToken` (new optional param). The bridge looks up the closed-session marker by `connectionToken`. If the marker exists → reject.
- On `session/start` with `refresh: true`, the caller presents a `token` (the composite integer). The bridge can decode `sid` from it. If the decoded session is in the closed-session marker table (keyed by `connectionToken`, which must also be presented) → reject.

### 2. Marker storage

**An in-memory `Map<string, ClosedSessionMarker>` in `session-manager.ts`, co-located with `_sessions`.**

```typescript
interface ClosedSessionMarker {
  sid: number;           // original SID at time of close
  name: string;          // session name at time of close
  closedAt: number;      // Date.now() at close
  expiresAt: number;     // closedAt + TTL_MS
}

const _closedMarkers = new Map<string, ClosedSessionMarker>(); // key = connectionToken
```

**Key:** `connectionToken` (UUID string). This is the session-private secret; only the correct caller can present it to trigger the rejection — it doubles as both the lookup key and the proof of identity.

**TTL:** Configurable via env var `CLOSED_SESSION_MARKER_TTL_MS`, default `86_400_000` (24 hours). Expired markers are swept lazily on read (check `expiresAt` in the lookup) and on a periodic sweep (every 10 minutes via `setInterval`, run in `startHealthCheck()` or a new `startMarkerSweep()` call in `index.ts`).

**Why in-memory, not on-disk:** TMCP is a stateless bridge; it already stores all live session state in-memory. The marker table only needs to outlive the closed session for the TTL. On process restart the marker is lost — this is acceptable because a process restart is itself a new process (new OS PID), which is a legitimate re-spawn. The zombie scenario is a running process that calls reconnect without restarting. Persistent storage would add complexity without practical benefit.

**Population:** `closeSessionById()` in `session-teardown.ts` is the single teardown path. Add a call to `recordClosedSessionMarker(connectionToken, sid, name)` immediately after the `closeSession(sid)` call succeeds (line 70 of `session-teardown.ts`). The `connectionToken` is captured from `sessionInfo` (already retrieved on line 55) before `closeSession()` removes the session from `_sessions`.

### 3. Rejection logic

Two check points, both in `src/tools/session/start.ts`:

**A. `handleSessionReconnect()` — lost-token reconnect path**

Add an optional `connection_token?: string` parameter to the tool's input schema. After the existing name-lookup succeeds and `fullSession` is resolved (around line 504 in current code), check anti-affinity before showing the Telegram approval dialog:

```typescript
if (connection_token) {
  const marker = getClosedSessionMarker(connection_token);
  if (marker) {
    return toError({
      code: "CALLER_CLOSED",
      message: `This caller held SID ${marker.sid} ("${marker.name}") which was closed. ` +
               `Reconnect is blocked until the marker expires or an operator unblocks it. ` +
               `A new session may be started by a legitimately new process.`,
      closed_sid: marker.sid,
      closed_name: marker.name,
    });
  }
}
```

Rejection occurs **before** the operator approval dialog fires — we must not surface a reconnect prompt to the operator for a zombie caller.

**B. `handleSessionStart()` — `refresh: true` reuse path**

The `refresh: true` path (lines 250–293 of current code) validates the composite `token` to reclaim a live session. Add a parallel `connection_token?: string` parameter. After decoding the token and locating the existing session, check anti-affinity:

```typescript
if (connection_token) {
  const marker = getClosedSessionMarker(connection_token);
  if (marker) {
    return toError({
      code: "CALLER_CLOSED",
      message: `This caller held SID ${marker.sid} ("${marker.name}") which was closed. ` +
               `Reconnect is blocked.`,
      closed_sid: marker.sid,
      closed_name: marker.name,
    });
  }
}
```

**HTTP response:** MCP tools return structured errors, not HTTP status codes directly. The `toError()` call with `code: "CALLER_CLOSED"` is the right layer. The Telegram bridge surfaces this as a tool error to the caller.

**No-presentation behavior:** If the caller does NOT present a `connection_token`, the anti-affinity check is skipped — the marker cannot be looked up without the key. This is intentional: a legitimately new process that happens to reconnect to the same session name has no `connectionToken` from the previous session and is not blocked. A zombie process that DID save the `connectionToken` will present it (following the onboarding hint) and be blocked.

> Note: this means a zombie that discards its `connectionToken` can still sneak through reconnect. The operator approval dialog is the backstop in that case — the operator sees the reconnect request and can deny it. Full enforcement requires the caller always present the token; we could add a "warn but allow" path when token is absent for a name whose previous session was recently closed.

### 4. Unblock path

Three ways the marker can be cleared:

**A. TTL expiry (automatic, default)**
After `CLOSED_SESSION_MARKER_TTL_MS` (default 24 h), the marker is swept and the caller identity is unblocked. This covers legitimate worker restarts after a long quiescent period.

**B. Explicit operator unblock via `action(type: 'session/unblock', connection_token: ...)`**
Add a new action handler (or extend `session/close`) that calls `clearClosedSessionMarker(connectionToken)`. The operator obtains the `connection_token` from the closed session's prior output or from a governor report. This satisfies AC3 (operator approval required to override).

**C. New session creation clears the old marker for the same name (optional)**
When a new session is created with the same name (operator-approved), optionally sweep markers for that name. This is lower priority — name-scoped sweeping requires an index by name as well as by token, adding complexity. Omit from initial implementation; add if needed.

**Governor reporting:** When `closeSessionById()` records the marker, also deliver a service message to the current governor noting the closed caller's `connectionToken` (prefixed with a note to keep it private and not post in Telegram). This gives the operator a handle for the unblock action without having to dig through logs.

### New functions to add in `session-manager.ts`

```typescript
// Add to _closedMarkers Map (above)
export function recordClosedSessionMarker(connectionToken: string, sid: number, name: string): void
export function getClosedSessionMarker(connectionToken: string): ClosedSessionMarker | undefined
export function clearClosedSessionMarker(connectionToken: string): boolean
export function sweepExpiredMarkers(): number  // returns count swept
```

### Scope summary

| File | Change |
|---|---|
| `src/session-manager.ts` | Add `_closedMarkers` Map, `ClosedSessionMarker` interface, and 4 new functions |
| `src/session-teardown.ts` | Call `recordClosedSessionMarker()` after `closeSession()` succeeds |
| `src/tools/session/start.ts` | Add `connection_token?` param to `handleSessionReconnect` and `handleSessionStart` (refresh path); add rejection check before operator dialog |
| `src/index.ts` | Schedule `sweepExpiredMarkers()` on an interval (every 10 min) |
| Tests | New regression test: close session → reconnect with same `connectionToken` → assert `CALLER_CLOSED` error |
