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

- [x] Zero stale parameter names (timeout vs max_wait)
- [x] Zero references to removed features (tutorial, instruction — confirmed still present in code, no removal needed)
- [x] All examples are runnable against current API
- [x] Service message content matches implementation

## Completion

Branch: `10-582`
Worktree: `D:\Users\essence\Development\cortex.lan\Telegram MCP\.worktrees\10-582`
Commit: `95686ba`

Fixed 4 files:
- `docs/help/dequeue.md` — replaced deprecated `timeout: 0` with `max_wait: 0`
- `docs/design.md` — replaced `timeout` with `max_wait` in tool description
- `docs/setup.md` — replaced `timeout: 0` with `max_wait: 0` in troubleshooting
- `docs/help/animation.md` — removed non-existent `reviewing` preset, added missing `dots` and `loading` with accurate descriptions; corrected `dots` description from "Three-dot ellipsis" to "Growing-dot animation inside block-character bar"

No stale `tutorial`/`instruction` references — both fields confirmed present in v6.1 source.
