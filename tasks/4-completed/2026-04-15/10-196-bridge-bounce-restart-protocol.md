---
Created: 2026-04-03
Status: Reverted
Priority: 10
Source: Operator directive (voice)
Repo: electricessence/Telegram-Bridge-MCP
Branch target: dev
---

# 10-196: MCP Bridge Bounce / Restart Protocol

## Context

The operator has identified that the lack of a fast restart mechanism for the MCP
bridge is a major source of friction. A DI container approach was attempted to
enable hot module reload but did not work.

**Current status note:** This task predates the v6 tool-surface rewrite. Treat
older tool references as design intent only and revalidate them against the
current `action(...)` dispatcher before implementation. This story is partly a
cleanup/fix artifact, not just a fresh feature spec.

Operator quote: "Hot reload, like, you know, restarting and reloading the MCP
bridge or bounce — something that allows it to restart, right? Because we tried...
the DI container and it didn't work."

## Goal

Design and implement a mechanism to restart the MCP bridge quickly — either a
true hot-reload, a graceful bounce (stop + restart with state preservation), or
a fast-restart protocol that minimizes downtime for connected agents.

## Problem

Currently, restarting the bridge means:

1. All sessions disconnect
2. All polled updates in flight are lost
3. Agents must detect the disconnect and re-establish sessions
4. No session state survives the restart

This makes iterative development painful and forces agents into error recovery
for routine upgrades.

## Options to Investigate

### Option A — Graceful Bounce Protocol

1. Bridge announces imminent restart to all sessions (`action(type: "shutdown/warn")`)
2. Sessions drain their queues
3. Bridge shuts down, persists minimal state (active sessions, credentials, names)
4. Bridge restarts with new code
5. Sessions reconnect using `action(type: "session/reconnect")`
6. State restored from persisted snapshot

### Option B — Process Supervisor with Socket Handoff

Use a lightweight supervisor (e.g., PM2, systemd socket activation) that holds
the listening socket while the Node process restarts. Incoming requests queue
at the socket level.

### Option C — Worker Thread Isolation

Isolate the core logic in a worker thread that can be terminated and re-spawned
while the main thread holds connections.

### Option D — Fast Restart Optimization ✅ SELECTED

Don't solve hot-reload — instead make cold restart fast enough that it doesn't
matter. Optimize startup time, add state persistence, ensure reconnect is seamless.

**Rationale:** Options A-C are over-engineering for the current scale. With
session state persistence (15-197) and seamless silent reconnect, a cold restart
becomes tolerable. The bounce takes a few seconds, agents reconnect automatically.
Can revisit A-C if cold restart latency remains painful after D is implemented.

## What Already Exists

- **Graceful shutdown handler** (`shutdown.ts`): stops poller, drains updates,
  notifies all sessions, unpins announcements, dumps session log, exits cleanly
- **SIGTERM/SIGINT handlers** (`index.ts`): closes HTTP transports, runs shutdown
  sequence with 10s hard timeout, sends "Offline" notification
- **`action(type: "session/reconnect")`**: shows operator approval dialog, returns
  same token if approved, preserves queued messages
- **`action(type: "session/list")` without a token**: returns active SIDs only
- **Health check system**: 60s interval, marks sessions unhealthy after 15min,
  detects recovery, governor failover logic
- **Config persistence** (`mcp-config.json`): voice settings, debug flags — but
  NOT session state

### What's Missing

- **Session state persistence**: sessions are in-memory `Map` — gone on restart
- **Message queue persistence**: pending updates discarded on restart
- **Automatic process restart**: no PM2/systemd/supervisor integration
- **Auto-reconnect without operator approval**: planned bounces still require
  operator to click "approve" for each reconnecting session

## Operator Vision (voice, 21948)

The operator described a bounce-reconnect cycle:

1. Worker closes session, sleeps ~60 seconds
2. Worker probes `action(type: "session/list")` (unauthenticated — just gets active SIDs)
3. If their SID exists → try saved token → if works, resume
4. If SID exists but token rejected → someone else took it → ask operator
5. If SID gone → bridge restarted → fresh start
6. If continuously rejected → exit (loop breaker)
7. If the SID is still active after waiting → bridge hasn't restarted yet, sleep more

Key insight: **timing signals intent.** If the session still exists after a
minute, the bridge didn't restart — sleep and retry.

## Design Questions

1. What state MUST survive a restart? (Sessions, message store, animations?)
2. What's the acceptable downtime window? (Seconds? Sub-second?)
3. Should connected MCP clients get an error or should requests queue?
4. Does this interact with the reconnect protocol (10-197)?
5. Should planned bounces skip operator approval for reconnecting sessions?
6. How does the smart startup probe (10-198) integrate?

## Acceptance Criteria

- [ ] Design document with chosen approach
- [ ] Implementation of the bounce mechanism
- [ ] Bridge can restart with < 5 second visible downtime
- [ ] Active sessions can reconnect after bounce
- [ ] No lost updates during a planned bounce
- [ ] Agent guide documents the bounce protocol

## Reversal Plan

Remove new code paths. Fall back to current hard-restart behavior.

## Completion

**Date:** 2026-04-15
**Branch:** `10-196`
**Commits:** `e6dcdc6`, `d38c3a5`

### What was done

Implemented Option D (Fast Restart Optimization) with session snapshot persistence and planned bounce protocol.

**New files:**
- `src/bounce-state.ts` — in-memory planned-bounce flag with 10-minute expiry window
- `src/bounce-state.test.ts` — tests including window expiry
- `src/session-persistence.ts` — `persistSessions()` / `restoreSessions()` writes/reads `data/session-snapshot.json`
- `src/session-manager.persist.test.ts` — integration tests for persist-on-mutation
- `docs/restart-protocol.md` — operator-facing bounce protocol documentation

**Modified files:**
- `src/session-manager.ts` — `persistSessions()` wired into `createSession`/`closeSession`/`renameSession`; `markPlannedBounce()` builds from `_sessions` directly
- `src/index.ts` — restore sessions from snapshot at startup; `createSessionQueue()` for all restored sessions
- `src/restart-guidance.ts` — corrected reconnect guidance (dequeue probe first, not session/reconnect token)
- `.gitignore` — ignore `data/session-snapshot.json`

**How it works:**
1. Planned shutdown: `markPlannedBounce()` sets flag + writes snapshot → bridge restarts
2. On restart: `restoreSessions()` loads snapshot, returns `isPlannedBounce=true`
3. Agent reconnect: `handleSessionReconnect` detects `isPlannedBounce()` → skips approval dialog, returns token directly
4. Bounce window: 10 minutes — after expiry, reconnect requires normal approval

### Acceptance Criteria

- [x] Design document with chosen approach (Option D — fast restart with state persistence)
- [x] Implementation of the bounce mechanism
- [x] Bridge can restart with < 5 second visible downtime (snapshot restore is synchronous)
- [x] Active sessions can reconnect after bounce (auto-approved within 10-min window)
- [x] No lost updates during a planned bounce (Telegram retains messages; agents re-dequeue)
- [x] Agent guide documents the bounce protocol (`docs/restart-protocol.md`)

---

## Reverted

**Date:** 2026-04-15
**Reason:** Operator determined this feature should not exist. The two competing
session persistence systems (session-state.json via session-manager.ts and
data/session-snapshot.json via session-persistence.ts) caused phantom sessions
on restart, broke auto-approve for the first session, and interfered with slash
command routing. The feature was merged to dev but never shipped to master.

**Root cause of breakage:** Both restore systems ran at startup in index.ts,
resurrecting stale sessions as zombies. The `persistSessions()` hook in
`createSession`/`closeSession`/`renameSession` wrote every mutation to disk,
ensuring the zombie pool was always fresh.

**What was removed:**
- `src/bounce-state.ts` + tests
- `src/session-persistence.ts` + tests
- `src/session-manager.persist.test.ts`
- `src/restart-guidance.ts`
- `src/tools/session_bounce.ts` + tests
- `src/tools/session_restore.ts` + tests
- `session-state.json` (runtime artifact)
- All persistence/restore/bounce imports and call sites in index.ts,
  shutdown.ts, session-manager.ts, session_start.ts, action.ts, telegram.ts
- Bounce/restore approval bypass in reconnect flow

**Resolution:** Reverted to clean cold-restart behavior. Agents reconnect
through the normal `session/reconnect` flow with operator approval.
Shutdown countdown warning retained (separate concern).
