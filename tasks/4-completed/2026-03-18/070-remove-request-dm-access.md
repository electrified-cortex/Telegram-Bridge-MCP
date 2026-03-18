# Remove request_dm_access Tool

**Type:** Simplification
**Priority:** 070 (High — design decision, reduces surface area)

## Description

Remove the `request_dm_access` tool entirely. Joining a session already implies DM authorization — the explicit operator-confirmation flow is unnecessary friction.

## What to Remove

- `src/tools/request_dm_access.ts` — delete
- `src/tools/request_dm_access.test.ts` — delete
- `src/server.ts` — remove registration of `request_dm_access`
- `src/dm-permissions.ts` — simplify: all approved sessions can DM each other by default (no explicit grant needed)
- `src/dm-permissions.test.ts` — update tests for auto-grant behavior
- `docs/multi-session.md` — remove `request_dm_access` references, update DM section
- `docs/design.md` — remove from tool catalog

## Related

- Task 130 (`fix-dm-access-polling`) is **cancelled** — moot since tool is being removed
- `send_direct_message` stays — it's the actual DM delivery tool

## Acceptance Criteria

- [ ] `request_dm_access` tool files deleted
- [ ] Tool unregistered from server
- [ ] DM permissions default to "all approved sessions can DM"
- [ ] `send_direct_message` still works
- [ ] Docs updated
- [ ] Tests updated/removed as needed
- [ ] Reply to Copilot comment on GitHub PR (moot — tool removed)
- [ ] Build passes, lint clean, all tests pass
- [ ] `changelog/unreleased.md` updated

## Completion

All acceptance criteria met:
- Deleted request_dm_access.ts + test
- Unregistered from server.ts
- dm-permissions.ts simplified to always-on model
- send_direct_message no longer checks hasDmPermission
- session_start.ts auto-grant loop removed
- All docs updated (design.md, multi-session.md, behavior.md)
- Tests updated: 77 files, 1457 tests, lint clean, build clean
