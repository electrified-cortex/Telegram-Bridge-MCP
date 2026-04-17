---
Created: 2026-04-15
Status: Queued
Host: local
Priority: 10-560
Source: Operator directive (API surface consistency)
---

# 10-560: Action route consistency audit

## Objective

Audit all tools and action routes for naming consistency. Identify
legacy underscore-named tools that should be routed through the action
dispatcher, inconsistent path structures, and non-RESTful patterns.

## Context

The v6 action dispatcher uses RESTful paths (`session/start`,
`log/debug`, `profile/load`). But some features still live on legacy
underscore-named tools (`get_debug_log`, `toggle_logging`) or are
routed inconsistently (`debug/dump` instead of `log/dump`).

Operator directive: everything should be RESTful through the action
dispatcher with consistent path naming.

## Acceptance Criteria

- [x] Complete inventory of all tools and action routes
- [x] Flag legacy underscore-named tools with migration recommendation
- [x] Flag action routes that break the `category/verb` pattern
- [x] Flag duplicate functionality (same feature on legacy tool + action)
- [x] Produce a migration plan with priority ordering
- [x] No code changes — audit and report only

## Audit Report (Revised — 2026-04-15)

### Summary

| Metric | Count |
|--------|-------|
| Directly registered MCP tools | 4 |
| Tool files with `register()` not in server.ts | 51 |
| Action routes (actual) | 44 |
| Routes following `category/verb` | 35/44 (80%) |
| Routes with naming issues | 9/44 (20%) |
| Redundant capabilities | 3 |

### MCP Tool Registry (server.ts imports)

| Tool | Status | Note |
|------|--------|------|
| `help` | Registered, clean | Discovery/documentation |
| `dequeue` | Registered, clean | Message queue polling |
| `send` | Registered, clean | Message dispatch (10 sub-types) |
| `action` | Dispatcher, clean | RESTful routes (44 paths) |

### Legacy Handler Files (51 files — `register()` defined but not in server.ts)

These files predate v6 and still export `register()`. They are imported internally by `action.ts` as handler modules, not as standalone MCP tools. The `register()` function in each is effectively dead code — the dispatcher invokes handlers directly without calling `register()`.

**Migration recommendation:** Remove `register()` exports from all 51 handler files (dead code). Any file that is NOT actually imported by `action.ts` is a fully orphaned legacy artifact and should be deleted.

Complete list:
`answer_callback_query`, `append_text`, `approve_agent`, `ask`, `cancel_animation`,
`cancel_reminder`, `choose`, `close_session`, `confirm`, `delete_log`,
`delete_message`, `download_file`, `dump_session_record`, `edit_message`,
`get_chat`, `get_chat_history`, `get_debug_log`, `get_log`, `get_message`,
`import_profile`, `list_logs`, `list_reminders`, `list_sessions`, `load_profile`,
`notify`, `notify_shutdown_warning`, `pin_message`, `rename_session`, `roll_log`,
`route_message`, `save_profile`, `send_chat_action`, `send_choice`,
`send_direct_message`, `send_file`, `send_new_checklist`, `send_new_progress`,
`session_start`, `set_commands`, `set_default_animation`, `set_dequeue_default`,
`set_reaction`, `set_reminder`, `set_topic`, `set_voice`, `show_animation`,
`show_typing`, `shutdown`, `toggle_logging`, `transcribe_voice`, `update_progress`

**Priority cleanup targets** (likely not imported by action.ts — confirm before delete):
- `dump_session_record` — functionality covered by `log/roll`
- `send_chat_action` — no corresponding action route
- `get_debug_log`, `toggle_logging` — superseded by `log/debug` and `logging/toggle`

### All 44 Action Routes

```
acknowledge          animation/cancel     animation/default    approve
chat/info            checklist/update     commands/set         confirm/ok
confirm/ok-cancel    confirm/yn           download             log/debug
log/delete           log/get              log/list             log/roll
logging/toggle       message/delete       message/edit         message/get
message/history      message/pin          message/route        profile/dequeue-default
profile/import       profile/load         profile/save         profile/topic
profile/voice        progress/update      react                reminder/cancel
reminder/list        reminder/set         session/close        session/idle
session/list         session/reconnect    session/rename       session/start
show-typing          shutdown             shutdown/warn        transcribe
```

### Flagged Action Routes (9 violations)

**High Priority — missing category prefix:**

| Current | Target | Effort |
|---------|--------|--------|
| `react` | `message/react` | LOW |
| `acknowledge` | `message/acknowledge` | LOW |
| `show-typing` | `message/show-typing` | LOW |
| `approve` | `session/approve` | MEDIUM |
| `shutdown` | `system/shutdown` | LOW |
| `download` | `message/download` | LOW |
| `transcribe` | `message/transcribe` | LOW |

**Medium Priority — wrong category or hyphenated sub-path:**

| Current | Target | Effort |
|---------|--------|--------|
| `logging/toggle` | `log/toggle` | LOW |
| `shutdown/warn` | `system/shutdown/warn` | LOW |
| `profile/dequeue-default` | `dequeue/default` | LOW |

> Note: `confirm/ok-cancel` and `confirm/yn` use hyphen and abbreviation in terminal segment — acceptable as preset-name variants, not path separators. Not flagged.

### Duplicate / Redundant Functionality

- `send(type:"checklist")` creates; `checklist/update` updates — split across tool boundary (acceptable but undocumented)
- `send(type:"progress")` creates; `progress/update` updates — same pattern
- `send(type:"question"/"choice")` overlaps with `confirm/ok`, `confirm/ok-cancel`, `confirm/yn` — multiple overlapping prompt paths

### Recommended Category Hierarchy (Future Standard)

```
session/, profile/, message/, reminder/, animation/,
checklist/, progress/, log/, chat/, confirm/,
dequeue/, commands/, system/
```

Anti-patterns: standalone routes (no category prefix), `logging/` (should be `log/`), hyphenated subcategories.

## Activity Log

- **2026-04-15** — Pipeline started. Variant: Review only (audit + findings, no code changes).
- **2026-04-15** — Explore agent dispatched. Full inventory of 4 tools + 2 orphaned handlers + 41 action routes produced.
- **2026-04-15** — Overseer revision request: route count wrong (41→44), 51 legacy handler files with `register()` unaudited, `logging/toggle` missed, no migration rec for handler files.
- **2026-04-15** — Re-audit complete. Corrected: 44 routes, 51 handler files inventoried, 9 violations (including `logging/toggle`), migration recommendations added.

## Completion

**Deliverable:** Audit report above. No code changes.

**Key findings (revised):**
1. 9/44 action routes violate `category/verb` pattern (7 missing prefix, 2 wrong category/structure)
2. 51 legacy handler files have `register()` dead code — recommend removal; verify which are imported by action.ts vs fully orphaned
3. 3 redundant capabilities across send/action boundary — well-defined but undocumented
4. Clean: 35/44 routes correct, 4 registered tools appropriate, snake_case filenames are correct TS convention

**Recommended next tasks:**
- Phase 1 renames (7 high-priority missing-prefix routes)
- Phase 2 renames (3 medium-priority: `logging/toggle`, `shutdown/warn`, `profile/dequeue-default`)
- Handler cleanup: audit action.ts imports, remove `register()` from handler modules, delete truly orphaned files
- Document `send` vs `action` division boundary
