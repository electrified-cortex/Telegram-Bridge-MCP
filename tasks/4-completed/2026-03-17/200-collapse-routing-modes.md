# Feature: Collapse Routing Modes → Governor-Only

## Type

Simplification / Refactor

## Priority

200

## Description

The codebase currently supports three selectable routing modes: `load_balance`, `cascade`, and `governor`. The operator never sees these — routing should be automatic and internal. Simplify to **one behavior**: first session = governor, ambiguous messages → governor, targeted messages → owning session.

## Current State

- `src/routing-mode.ts` — module with `setRoutingMode()`, `getRoutingMode()`, supports 3 modes
- `src/tools/pass_message.ts` — cascade-only tool (forward to next in chain)
- `src/built-in-commands.ts` — `/routing` command shows mode selection panel
- `src/session-queue.ts` — `routeToSession()` branches on mode for ambiguous messages
- `src/tools/dequeue_update.ts` — injects `pass_by` (cascade) and `routing` (governor) metadata
- `session_start` sets governor mode automatically when 2nd session joins
- Tests reference all 3 modes in various files

## Design

### Remove

- `pass_message` tool — cascade concept is gone
- `/routing` built-in command — no user-facing routing selection
- `load_balance` and `cascade` branches in `routeToSession()`
- Cascade pass deadlines (`_cascadePassDeadlines` map, `setCascadePassDeadline`, `popCascadePassDeadline`)
- `pass_by` injection in `dequeue_update`
- `routing_mode` field from `session_start` response — the server is role-agnostic; agents don't need to know how routing works

### Simplify

- `routing-mode.ts` — keep but simplify. Only `"governor"` mode exists. `setRoutingMode("governor", sid)` is called on session_start when 2nd session joins. Or just hard-code the governor as SID 1 / first session.
- `routeToSession()` — targeted → owning session. Ambiguous → governor (first session). Fallback if governor queue gone → broadcast.
- `dequeue_update` — always include `routing: "targeted" | "ambiguous"` (not just in governor mode). Agents should always know.

### Keep

- `route_message` tool — governor uses this to delegate ambiguous messages to workers
- `send_direct_message` tool — inter-session DMs
- `request_dm_access` tool — keep for now (separate task handles auto-grant)

## Acceptance Criteria

- [ ] `pass_message` tool removed
- [ ] `/routing` built-in command removed
- [ ] `routing-mode.ts` simplified (no mode selection, governor is the only behavior)
- [ ] `routeToSession()` has two paths: targeted → owner, ambiguous → governor
- [ ] `dequeue_update` includes `routing: "targeted" | "ambiguous"` in all cases (not just governor mode)
- [ ] Cascade pass deadline code removed from session-queue
- [ ] All affected tests updated
- [ ] TypeScript builds clean, all tests pass
- [ ] Changelog updated
