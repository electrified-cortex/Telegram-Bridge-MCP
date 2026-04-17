---
Created: 2026-04-09
Status: Draft
Host: local
Priority: 10-416
Source: Operator feedback on v6 migration guide (2026-04-09)
---

# v6 API Refinements — Operator Feedback

## Objective

Capture and implement refinements to the v6 API surface based on operator review
of the migration guide (docs/migration-v5-to-v6.md). These are post-v6 launch
enhancements — they do not block PR #126 merge.

## Context

Operator reviewed the v6 Tool/Path Reference and provided detailed voice feedback
on naming, flags, and permissions. Items grouped by scope.

## Items

### 1. Silent/notification flag for pins and messages — APPROVED

Telegram supports `disable_notification` on most message sends and all pin
operations. Currently not exposed in our API.

- Add `silent?: boolean` parameter globally
- Default: `false` for most operations
- **Default `true` for `message/pin` and `notify`** (operator decision)
- Overridable in all cases

### 2. Session rename + color change

Allow `session/rename` to also accept a `color` parameter, avoiding a separate
API call.

- Add optional `color` param to `session/rename`
- Governor can target other sessions (specify `target_sid`)
- Validate color against COLOR_PALETTE

### 3. Session permission codification

Clarify and enforce which session actions are governor-only vs self-only vs
anyone.

| Path | Current | Should Be |
| --- | --- | --- |
| `session/list` | Anyone | Anyone |
| `session/start` | Anyone | Anyone |
| `session/close` | Self only | Self OR governor (any session) |
| `session/rename` | Self (with approval) | Self OR governor (any session) |

### 4. Path naming review — APPROVED: flatten to message/*

Operator confirmed: `history/message` → `message/get`. Phase out `history/`
category. Flatten reads and writes under `message/*`.

- `message/get` (was `history/message`)
- `history/chat` → `message/chat` or keep as-is (TBD)
- Goal: everything message-related under one category

### 5. log/dump cleanup — APPROVED: remove

`log/dump` is a legacy alias for `log/roll` from the session recording era.
Already tracked in 10-361 (remove session record feature).
Operator confirmed: absolutely remove.

## Operator Decisions (2026-04-09)

All items approved. Specific rulings:
- `silent` defaults `true` for pin and notify — CONFIRMED
- `history/*` flattened to `message/*` — CONFIRMED
- `log/dump` removed — CONFIRMED
- Rename + color combined — CONFIRMED
- Session permissions as spec'd — CONFIRMED

## Acceptance Criteria

- [ ] Items 1-4 implemented with tests
- [ ] `help` output updated to reflect changes
- [ ] Migration guide updated

## Completion

- **Branch:** `10-416-v6-operator-refinements` (worktree: `Telegram MCP/.worktrees/10-416-v6-operator-refinements`)
- **Commit:** `e709394` — feat(session/rename): add color + governor targeting support
- **Files:** `src/session-manager.ts`, `src/tools/rename_session.ts`, `src/tools/rename_session.test.ts`, `src/tools/action.ts`
- **Notes:** Items 1 (disable_notification), 4 (message/get), and 5 (log/dump) were already implemented/removed — no changes needed. Implemented item 2 (session/rename + color) and item 3 (governor can rename other sessions via target_sid). Tests: 2353/2353 pass.
