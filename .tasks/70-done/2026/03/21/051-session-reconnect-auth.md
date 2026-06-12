# 051 — Session Reconnect via Operator Authorization

## Problem

When an agent loses its PIN (context compaction, crash, etc.) but its session is still active, it's stuck:

1. Calls `session_start(name: "Overseer")` → `NAME_CONFLICT` with SID but no PIN
2. Can't call `dequeue_update(sid=N)` without the PIN
3. Only option today: ask operator to restart the server or close the session manually

## Solution

Add an operator-authorized reconnect flow to `session_start`.

### Handshake

```text
Agent calls session_start(name: "Overseer")
  → NAME_CONFLICT: "...call session_start with reconnect: true to request re-authorization"

Agent calls session_start(name: "Overseer", reconnect: true)
  → Server shows operator a simple ✅ Yes / ⛔ No approval dialog
  → If approved: return the SAME SID and SAME PIN (agent regains access)
  → If denied: SESSION_DENIED error
```

### Key Design Decisions

- **PIN is not re-rolled.** The operator is authorizing the agent to receive the existing secret. The PIN stays the same.
- **Always requires operator approval.** Even for single-session mode — the operator must explicitly authorize giving back the PIN.
- **Simple yes/no dialog.** Not the color-picker approval used for new sessions. No color change needed.
- **Session state preserved.** Queue, governor status, announcement — all stay intact. Only `lastPollAt` and `healthy` are reset.

## Files to Change

### `src/tools/session_start.ts`

1. **Update `NAME_CONFLICT` error message** (line ~165):
   - Current: `"If you still have the PIN, resume with dequeue_update(sid=N). Otherwise, ask the operator to close the stale session or restart the server."`
   - New: `"If you still have the PIN, resume with dequeue_update(sid=N). To start a new session, choose a different name. To reclaim this session, call session_start again with reconnect: true."`

2. **Add reconnect handler** in the NAME_CONFLICT block (line ~165):
   - When `reconnect: true` AND name matches an existing session:
     - Show a simple yes/no approval dialog to the operator (new function, not `requestApproval` which is color-based)
     - Dialog text: `"🤖 Session reconnecting: {name}\nAuthorize re-entry?"` with `✅ Approve` / `⛔ Deny` buttons
     - If approved: call `getSession(existing.sid)` to get the full session object (has the PIN), reset `lastPollAt` and `healthy`, drain stale queue events, set active session, return `{ sid, pin, sessions_active, action: "reconnected", pending: 0 }`
     - If denied or timeout: return `SESSION_DENIED`
   - Deliver appropriate service messages to the reconnected session and any fellow sessions
   - Call `refreshGovernorCommand()`

3. **Update `DESCRIPTION`** to mention the reconnect-for-reauth flow.

4. **Update `reconnect` parameter description** to mention the reauthorization use case.

### `src/session-manager.ts`

1. **Add `touchSession` reset helper** or just use `getSession()` directly:
   - The handler needs to reset `lastPollAt = undefined` and `healthy = true` on the existing session
   - `touchSession()` already exists but sets `lastPollAt = Date.now()` — may want a dedicated reset, or just do it inline

### `src/session-queue.ts`

- Use existing `drainQueue(sid)` to clear stale events from the session's queue before returning

### `changelog/unreleased.md`

- Add entry under `### Added`

## Acceptance Criteria

- [x] `session_start(name: "X")` when "X" exists returns NAME_CONFLICT with reconnect hint
- [x] `session_start(name: "X", reconnect: true)` when "X" exists shows yes/no dialog
- [x] Operator approval returns same SID and same PIN
- [x] Operator denial returns SESSION_DENIED
- [x] Timeout (60s) returns SESSION_DENIED
- [x] Session state (queue, governor, announcement) is preserved
- [x] Service messages sent to reconnected session and fellow sessions
- [x] Build passes, tests pass, lint passes
- [x] Changelog updated

## Completion

**Commit:** `e143ab5` (branch `dev`)

**Files changed:**
- `src/tools/session_start.ts` — Added `requestReconnectApproval` function, reconnect handler in NAME_CONFLICT block, updated DESCRIPTION and reconnect param description. Added imports for `getSession` and `drainQueue`.
- `src/tools/session_start.test.ts` — Added `getSession` and `drainQueue` mocks; added 9 new reconnect flow tests covering: approval dialog format, same SID/PIN return, health reset, queue drain, denial, timeout, service messages (single and multi-session), dialog edit on denial, and fallthrough-to-new-session when no name collision.
- `changelog/unreleased.md` — Added entries under `### Added`.

**Test results:** 1468 passed (1558 total including todos/skips), 0 failures.  
**Build:** clean. **Lint:** clean.
