---
Created: 2026-04-12
Status: Draft
Host: local
Priority: 20-499
Source: Operator directive (dogfooding critique, thinking out loud)
---

# 20-499: Refactor tool file structure to match v6 API paths

## Objective

Restructure the TMCP `src/tools/` directory so that file paths match the
v6 action/path API surface. Eliminates confusion between internal file
names (underscore-separated) and external API paths (slash-separated).

## Context

v6 introduced path-based tool names: `session/start`, `reminders/list`,
`profile/load`, etc. But the source files still use flat underscore names:
`session_start.ts`, `list_reminders.ts`, `load_profile.ts`.

This causes agents (and developers) to default to the wrong format. Even
experienced agents write `list_reminders` when they mean `reminders/list`.

## Proposed Structure

```text
src/tools/
  session/
    start.ts
    close.ts
    list.ts
    rename.ts
  reminders/
    set.ts
    cancel.ts
    list.ts
  profile/
    load.ts
    save.ts
    import.ts
  message/
    send.ts
    edit.ts
    delete.ts
    pin.ts
  ...
```

## Scope

v6.5 — not blocking current work. Filed as priority 20 (low urgency).

## Acceptance Criteria

- [x] Tool files organized by API path namespace (session/, reminders/, etc.)
- [x] Tool registration names unchanged (backward compatible)
- [x] All imports updated to new paths
- [x] Tests updated for new file locations
- [x] No functional changes — pure restructure

## Notes

- Large refactor. May benefit from incremental approach (one namespace at a time).
- Operator noted this explicitly as a "v6.5 or something like that" scope item.

## Completion

Branch: `20-499` in `D:/Users/essence/Development/cortex.lan/Telegram MCP/.worktrees/20-499`

All 6 prior commits (first wave: session/, reminder/, profile/, log/, logging/, message/, chat/) plus final commit `d780988` (second wave + import depth fixes). 103 files changed across 22 namespace dirs.

Build PASS · Test 2601/2601 PASS · 2026-04-25
