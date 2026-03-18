# Feature: Server Restart Session Recovery

## Type

Feature / Reliability

## Priority

400 (post-merge — not blocking PR #40)

## Description

All session state is in-memory. When the MCP server restarts (crash, manual restart, deploy), every session is lost. Agents reconnect and call `session_start` again, creating new sessions with new SIDs and PINs. The operator sees duplicate "joined" messages.

## Current Architecture (v4)

| State | Storage | Survives restart |
| --- | --- | --- |
| Sessions (SID, PIN, name, health) | In-memory `Map<number, Session>` | No |
| Governor SID | In-memory variable | No |
| Per-session queues | In-memory `TwoLaneQueue` | No |
| DM permissions | In-memory `Map` | No |
| Message timeline | In-memory store (optional file log) | Optional |

On restart:

1. All sessions destroyed (`_sessions` Map cleared)
2. All session queues destroyed
3. Governor SID resets to `undefined`
4. Agents reconnect and call `session_start`
5. First agent gets SID 1 ("Primary"), second triggers auto-governor on lowest SID
6. New SIDs assigned from 1 — completely fresh state

## Problems

- **No session continuity** — agent loses its SID/PIN identity
- **Duplicate announcements** — operator sees "has joined" again for every agent
- **Lost governor context** — governor assignment resets (but auto-governor-on-second-join recovers this)
- **Lost DM permissions** — auto-grant on approval recovers this too
- **Race condition** — multiple agents reconnect simultaneously, all calling `session_start`

## What Already Self-Heals

Several v4 mechanisms reduce the actual impact:

- **Auto-governor**: Lowest SID becomes governor when second session joins (task 200)
- **Auto-DM-grant**: Bidirectional DM granted on session approval (task 250)
- **Health-check**: 60s interval monitors `lastPollAt`; operator gets 3-option prompt for dead governor (task 300)
- **Name collision guard**: `session_start` rejects duplicate names, so agents can't accidentally create two "Primary" sessions

The real pain is cosmetic (duplicate announcements) and the name collision guard (agent's old name is gone, but "Primary" auto-assigns to first, so it works unless the agent explicitly names itself something custom).

## Design Options

### Option A: Graceful re-establishment (recommended)

Don't persist state. Instead:

1. `session_start` accepts optional `reconnect: true` parameter
2. If reconnecting, the intro message says "reconnected" instead of "joined"
3. Governor auto-set handles itself via existing lowest-SID logic
4. DM auto-grant handles itself via existing approval flow

**Pro:** Simple. No persistence. Leverages existing self-healing.
**Con:** SID/PIN change. Agent must re-discover its identity.

### Option B: Persisted session state

Write `sessions.json` to disk. On restart, reload. Agent provides old SID/PIN and server restores.

**Pro:** True continuity — SID/PIN survive restart.
**Con:** Complexity. Stale session cleanup. File corruption. PIN validation across restarts.

### Option C: Accept it (document the limitation)

Document that restart resets everything. Agents handle it via `session_start`. Move on.

**Pro:** Zero implementation cost.
**Con:** Operator confusion on restart.

## Recommendation

Option A. The v4 architecture already self-heals governor assignment, DM grants, and health monitoring. The remaining pain is:

1. Duplicate "joined" messages → fix with `reconnect` flag
2. Agent identity loss → not fixable without persistence, but tolerable

Option B may be warranted later if agents need SID continuity for long-running workflows.

## Acceptance Criteria

- [ ] `session_start` accepts `reconnect` boolean parameter
- [ ] Reconnecting session shows "reconnected" instead of "joined"
- [ ] Governor auto-set still works correctly after restart
- [ ] DM auto-grant still works correctly after restart
- [ ] Test: two agents reconnect after restart — governor re-established
- [ ] All tests pass: `pnpm test`
