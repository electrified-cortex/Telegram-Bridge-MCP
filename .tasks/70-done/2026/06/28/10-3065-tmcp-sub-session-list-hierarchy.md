---
created: 2026-06-27
status: draft
priority: 20
source: Operator voice TG 80387, 80412; split from 10-3062 Gap 5
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature / UX
severity: medium
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# TMCP — Session List Drill-Down for Child Sessions

**ID**: 10-3065
**Date**: 2026-06-27
**Priority**: P2
**Origin**: Operator TG 80387 + 80412; split from 10-3062 Gap 5

## Problem

Child sessions currently appear as peers in the session list alongside root sessions. The operator sees "Curator ①" as a top-level entry alongside Curator, Overseer, Ops — same visual weight. This clutters the list and invites confusion about session hierarchy.

## Design Decision (operator-confirmed TG 80412)

**Drill-down pattern:**

1. **Top-level session list** — child sessions do NOT appear as standalone entries. Parent sessions show a sub-session count when children are active (e.g. "Curator (2 sub-sessions)").
2. **Session detail panel** (drill-down) — when the operator taps/clicks a parent session, the detail view shows:
   - Parent session info + actions (close, set as primary, etc.)
   - A list of its active child sessions, each with a close action
3. **Governor selection panel** (`/primary`) — child sessions are excluded entirely. Only root sessions are selectable as governor.
4. **Never promotable** — child sessions must never appear as governor candidates (reinforced by 10-3064 hard-block in code).

> Operator (TG 80412) requested: show a sub-session count on the parent entry; tapping the parent should drill down to a detail view where both the parent and its child sessions can be closed individually; sub-sessions must never appear as governor candidates.

## Scope

All changes in `src/built-in-commands.ts`:

| Function | Change |
|----------|--------|
| Session list rendering (top-level) | Filter out sessions where `parent_sid !== undefined`; show count annotation on parent if it has active children |
| `renderSessionDetail` | Add child session sub-list when parent has active children; each child shows close button |
| `buildGovernorPanel` (governor selection) | Filter out sessions where `parent_sid !== undefined` entirely |
| Session count display | Where total session count is shown, clarify whether children are included or excluded |

`health-check.ts` already identifies child sessions via `session.parent_sid !== undefined` — the field is available on all session objects.

The child registry (`child-registry`) tracks which SIDs are children of which parent. The Worker may need to call into this module (or `listSessions()` and filter by `parent_sid`) to enumerate a parent's children.

## Acceptance Criteria

- [ ] **AC1**: `grep -c "parent_sid" src/built-in-commands.ts` returns ≥ 3 (top-level list filter, detail panel child list, governor panel filter)
- [ ] **AC2**: Top-level session list does NOT include sessions with `parent_sid !== undefined` as standalone entries
- [ ] **AC3**: When a parent session has active children, the session count or label reflects this (e.g. "2 sub-sessions" annotation)
- [ ] **AC4**: `renderSessionDetail` (or equivalent) for a parent with active children renders a child sub-list with close actions for each child
- [ ] **AC5**: `buildGovernorPanel` excludes sessions with `parent_sid !== undefined` — `grep` for the filter condition in that function's scope
- [ ] **AC6**: Unit test: top-level list rendering omits a child session
- [ ] **AC7**: Unit test: `renderSessionDetail` for a parent with one active child shows that child with a close button
- [ ] **AC8**: Unit test: `buildGovernorPanel` does not include a child session in the keyboard options

## Dependencies

- **10-3064** (governor hard-block): should merge first — provides the code-level safety net before the UX layer ships. This task can be developed in parallel.
- **10-3057** (topic chip guarantee): suggested merge before this ships so child sessions show correct topic chips in the detail panel.

## Delegation

Ready for Overseer gate → Worker

## Verification

**Status**: APPROVED  
**Verifier**: a11eeec7121ee7844  
**Date**: 2026-06-28  
**Squash commit**: 2f20d4b  

All 8 ACs confirmed:
- AC1: `parent_sid` appears ×4 (≥3) in `src/built-in-commands.ts` ✓
- AC2: Top-level session list skips child sessions (`parent_sid !== undefined` filter) ✓
- AC3: Parent shows "(N sub-sessions)" annotation when children active ✓
- AC4: `renderSessionDetail` renders child close buttons for each active child ✓
- AC5: `buildGovernorPanel` excludes child sessions ✓
- AC6: Unit test — top-level list omits child session ✓
- AC7: Unit test — detail panel shows child with close button ✓
- AC8: Unit test — `buildGovernorPanel` excludes child session ✓

Test gate: 4014/4014 pass, `.temp/test-results.md` present.
