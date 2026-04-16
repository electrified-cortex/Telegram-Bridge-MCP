---
Created: 2026-04-16
Status: Queued
Target: telegram-mcp-bridge
Priority: High
---

# 10-582 — Full Doc Alignment Audit for v6.1 Release

## Goal

Verify all docs accurately reflect the current codebase
before v6.1 merges to master. No stale references, no
wrong parameter names, no removed features still documented.

## Scope

1. All docs/help/ topics — verify examples match code
2. Service message onboarding — verify the 3 messages
   match what session_start actually injects
3. Reaction system docs — verify preset name, temporality
   defaults, base reaction behavior match implementation
4. Tutorial/instruction removal — verify no docs reference
   these removed fields
5. docs/communication.md, agent-setup.md, design.md —
   high-level docs match v6.1 reality

## Acceptance Criteria

- [ ] Zero stale parameter names (timeout vs max_wait)
- [ ] Zero references to removed features (tutorial, instruction)
- [ ] All examples are runnable against current API
- [ ] Service message content matches implementation
