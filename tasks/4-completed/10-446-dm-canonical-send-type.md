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
