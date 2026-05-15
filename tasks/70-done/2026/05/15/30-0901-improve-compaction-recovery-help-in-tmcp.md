---
created: 2026-05-14
status: 10-drafts
priority: 30-0901
source: overseer-session-2026-05-14
repo: Telegram MCP
type: Documentation / DX
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# 30-0901 — Improve compaction-recovery guidance in TMCP help system

## Context

Agents using TMCP lose their Monitors after context compaction. The activity-file monitor
that wakes agents on incoming Telegram messages disappears silently. This is documented
in pod skill files but not surfaced cleanly inside TMCP's own help system where agents
look at runtime.

The correct recovery sequence is:
1. Call `action(type: "activity/file/get")` to find the current active file path
2. Stop any stale monitor (if registered — it won't actually fire after compaction but may
   still appear registered)
3. Re-arm a fresh monitor on the path returned by `activity/file/get`
4. Do NOT create a new activity file — reuse the existing path to avoid proliferation

Currently `help(topic: "activity/file")` covers create/edit/delete but not the
post-compaction re-arm pattern. Agents are left to infer the correct sequence from
skill files, which may be out of date.

## Acceptance Criteria

1. `help(topic: "compaction-recovery")` (or equivalent) exists in TMCP and describes:
   - Why monitors don't survive compaction
   - The get → stop-old → re-arm sequence
   - That `activity/file/get` is the source of truth for the current path
   - Warning against creating a new file on every recovery (causes proliferation)

2. `help(topic: "activity/file")` links to or mentions compaction recovery so agents
   find it organically.

3. No change to the actual monitor behavior — this is documentation only.

## Target branch

dev

## Completion

Added `docs/help/compaction-recovery.md` (new topic) covering why monitors don't survive compaction, the get→stop→re-arm sequence, `activity/file/get` as source of truth, and warning against `activity/file/create` on recovery. Added `"compaction-recovery"` to `RICH_TOPICS` in `src/tools/help.ts`. Updated `docs/help/activity/file.md` with a link to the new topic. 2 new test assertions in `help.test.ts`. Commit `94f639e4` on branch `30-0901`.

## Verification

APPROVED — 2026-05-15. All 3 criteria confirmed: `help('compaction-recovery')` topic exists with required content, `help('activity/file')` links to it, no behavioral changes introduced. Cherry-picked as `42058aeb` onto `dev`.

Sealed-By: foreman
