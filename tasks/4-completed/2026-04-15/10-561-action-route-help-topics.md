---
Created: 2026-04-15
Status: Queued
Host: local
Priority: 10-561
Source: Operator directive (documentation breadcrumbs)
---

# 10-561: Help topics for every action route

## Objective

Every action route needs a `docs/help/<route>.md` file with documentation,
usage examples, and breadcrumbs to related routes. Agents should be able
to call `help(topic: "shutdown/warn")` and get actionable docs.

## Context

The 10-560 audit identified 44 action routes. Many have no help topic.
Agents currently rely on the guide or guessing. Each route should be
self-documenting via the help system.

## Scope

For each action route category:
- `session/*` — start, reconnect, list, close, rename, idle
- `shutdown/*` — warn
- `profile/*` — load, save, voice, topic, dequeue-default, import
- `message/*` — edit, delete, pin, get, history, route
- `log/*` — debug, get, list, roll, delete, trace (post 10-498)
- `reminder/*` — set, cancel, list
- `animation/*` — default, cancel
- `commands/*` — set
- `react`, `acknowledge`, `show-typing`, `approve`, `download`, `transcribe`
- `confirm/*`, `checklist/*`, `progress/*`

## Acceptance Criteria

- [x] Every registered action route has a `docs/help/` topic file
- [x] Each topic includes: description, parameters, example, related routes
- [x] `help(topic: "<route>")` returns the content
- [x] Breadcrumb links between related routes (e.g. shutdown/warn → session/close)
- [x] Category index topics (e.g. `help(topic: "session")` lists all session routes)

## Activity Log

- **2026-04-15** — Pipeline started. Variant: Implement only (doc-only, no code changes). Branching from 10-507 (docs/help/ structure already present).
- **2026-04-15** — [Stage 4] Task Runner dispatched. 53 files created across all route categories. tsc clean.
- **2026-04-15** — [Stage 5] Skipped — doc-only changes.
- **2026-04-15** — [Stage 6] Code Reviewer: 1 critical (confirm/* phantom params), 4 major (react aliases incomplete; profile/save wrong related; session/reconnect missing response field; yes_text/no_text hardcoded). All fixed in second Task Runner pass. tsc re-verified clean.
- **2026-04-15** — [Stage 7] Complete. Branch: 10-561, commits: bf3e25f + a7b6c44. Ready for Overseer review.

## Completion

**What was implemented:**
- 53 new `docs/help/` files covering all 44 action routes + category index files
- Categories: session/*, shutdown/warn, profile/*, message/*, log/*, logging/toggle, reminder/*, animation/*, commands/*, confirm/*, checklist/update, progress/update, chat/info
- Standalone routes: react, acknowledge, show-typing, approve, download, transcribe
- Each file: description, params, examples with real `action(type: "...")` calls, Related breadcrumbs
- Existing files preserved (shutdown.md, animation.md, checklist.md, reminders.md, etc.)

**Subagent passes:** Task Runner ×2 (initial + fixes), Code Reviewer ×1

**Final review verdict:** 0 critical, 0 major (after fixes), 5 minor (noted)

**Dependency note:** Must merge after 10-496 → 10-502 → 10-507. Merge order: 10-496 → 10-502 → 10-507 → 10-561.
