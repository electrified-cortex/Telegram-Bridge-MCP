---
Created: 2026-04-10
Status: Queued
Host: local
Priority: 10-446
Source: Operator via Overseer — "dm should be canonical, direct the alias"
---

# Make `dm` the canonical send type, `direct` the alias

## Objective

Rename the `send(type: "direct")` message type to `send(type: "dm")` as the
canonical form, keeping `"direct"` as a backward-compatible alias. Update all
skill docs, agent files, and the API guide to use `dm` as the primary reference.

## Context

The operator flagged that `"direct"` is not the intuitive name for DM delivery.
Agents discovering the API should land on `dm` first. Currently the codebase uses
`"direct"` as the primary type in the send dispatcher.

This is a discoverability improvement — agents using `"direct"` should continue
to work, but docs and examples should reference `"dm"`.

## Acceptance Criteria

- [ ] `send(type: "dm")` accepted as canonical type in the message dispatcher
- [ ] `send(type: "direct")` still works as an alias (no breaking change)
- [ ] API guide (`docs/api-v6-guide.md` or equivalent) updated to use `dm`
- [ ] `telegram-mcp-session-startup` skill updated
- [ ] `telegram-mcp-communication` skill updated
- [ ] Agent files referencing `"direct"` updated to `"dm"`
- [ ] Built-in command descriptions updated if they reference direct messaging

## Completion

**Branch:** `10-446` in `.worktrees/10-446`
**Commit:** `763dfff` (committed by Overseer — git commit blocked for Worker role)

### What changed

- `src/tools/send.ts`: Added `SEND_ALIASES = ["direct"]` as hidden alias list. Removed `"direct"` from `SEND_TYPES` so it never appears in discovery output or error messages. Added `resolvedType` normalization mapping `"direct"` → `"dm"` before the switch. Case handler updated to `case "dm":` only. Updated DESCRIPTION, type param describe, and target_sid describe to reference `"dm"`.
- `src/tools/send.test.ts`: Added `"dm"` missing-target_sid, missing-text, and happy-path tests. Added `"direct"` backward-compat alias test. 2167 tests pass.
- `docs/behavior.md`: 3 occurrences of `send(type: "direct")` updated to `send(type: "dm")`; alias note added.
- `docs/migration-v5-to-v6.md`: Migration table and code example updated to `send(type: "dm")`; backward-compat note added.

### Why

Operator directive: `"dm"` is the intuitive canonical name. `"direct"` remains accepted as a hidden alias for backward compatibility — not advertised in discovery or error output.

### Scope notes

Skills (`telegram-mcp-session-startup`, `telegram-mcp-communication`) and agent files had no `"direct"` send type references — no changes needed there.

### Review findings

- Pass 1: 2 Major (direct in SEND_TYPES exposing alias; missing dm missing-text test) — both fixed
- Pass 2: 2 Minor (no discovery assertion test; no direct alias happy-path test) — acceptable, not blocking
- All Critical/Major: none at completion
