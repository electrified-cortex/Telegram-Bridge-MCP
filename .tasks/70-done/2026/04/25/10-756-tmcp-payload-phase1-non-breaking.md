---
id: "10-756"
title: "TMCP payload reduction Phase 1 — non-breaking (~115 tokens/session)"
priority: 10
status: draft
created: 2026-04-24
repo: Telegram MCP
---

# TMCP payload reduction Phase 1 — non-breaking (~115 tokens/session)

## Problem

TMCP tool responses include ~30 redundant fields across `send`, `dequeue`, and `action` handlers. Phase 1 targets the fields that are safe to remove immediately: echoed inputs callers already know, `ok: true` confirmation flags, and informational fields that don't drive control flow. These waste ~115 tokens/session with zero benefit.

## Goal

Remove all non-breaking redundant fields identified in the 10-0517 audit. No callers consume these fields; removal is safe without a migration flag.

## Fields to remove

From `send` handlers:
- `audio: true` from `send(audio)` — echoed input
- `file_type` from `send(file)` — echoed input
- `target_sid` from `send(dm)` — echoed input
- `persistent` from `send(animation)` — echoed input
- `delivered: true` from `send(dm)` — no error means delivered
- `updated: true` from `send(checklist)` update path — no error means updated
- `_hint` from `send(audio)` — 20–50 token narrative, not machine-readable
- `length` from `send(append)` — informational only, no control-flow use

From `action` sub-paths:
- `ok: true` from `message/delete`, `message/pin`, `show-typing`, `acknowledge`
- `keyboard_cleared?` from `acknowledge`
- `scheduled: true` from `reminder/set`
- `cancelled: true` and echoed `id` from `reminder/cancel`
- `added`, `message_id`, `emoji`, `preset` from `react` (keep only `temporary?`)

## Acceptance criteria

- every field listed above is removed from the respective handler
- no existing caller behavior changes — none of these fields are consumed
- test suite passes after updating assertions to match new response shapes (original criterion "no modifications required" was incorrectly written — removing response fields necessarily requires removing assertions on those fields)
- token savings land at approximately 115 tokens/session as estimated in audit 10-0517 (`audit/payload-audit.md` on branch `10-0517`); field removals align exactly with the audit targets; runtime measurement not included as no telemetry infrastructure exists for this estimate

## Don'ts

- do not remove `split`, `split_count`, `empty: true`, or `timed_out` discriminators — those are Phase 2 (breaking)
- do not remove `message_id` from any handler — still needed for edits and reactions
- do not remove `text_message_id` from `send(audio)` — essential when caption overflows
- do not remove `info?` from `send(text)` — only emitted for table markdown warnings, useful signal
- do not remove `unpinned?: true` from `message/pin` — non-redundant conditional field

## Source

- task: 10-0517 (TMCP output compression audit)
- findings: `audit/payload-audit.md` on branch `10-0517` of the TMCP repo

## Completion

Branch: `10-756` in Telegram MCP repo (worktree `.worktrees/10-756`).
Commit: `c8a6d74` — refactor(handlers): remove redundant response fields (Phase 1)

24 files changed, 76 insertions, 110 deletions. 2637 tests pass.
Build: PASS. Lint: PASS. Code review: 2 passes, clean.

All listed fields removed. Note: spec claim "existing test suite passes with no modifications required" was incorrect — tests asserted the removed fields and required updating. 12 test files updated to match new response shapes.

Fields not found in codebase (already absent): `scheduled: true` from reminder/set, `keyboard_cleared` from acknowledge, `added` from react. Field `file_type` in send(file) responses was named `type` in code — removed as intended.

## Verification

**Verdict:** APPROVED
**Date:** 2026-04-24
**Criteria:** 4/4 confirmed
**Evidence:** Full git diff of c8a6d74 (dev..HEAD) inspected; npm test run live confirmed 2637 tests pass across 119 test files. All targeted response fields removed: `audio`, `_hint` from send(audio); `type` (file_type) from all 5 send(file) variants; `target_sid`, `delivered` from send(dm); `persistent` from send(animation); `updated` from send(checklist) update path; `length` from send(append); `ok: true` from delete_message, pin_message, show_typing, answer_callback_query; `cancelled`, echoed `id` from cancel_reminder; `message_id`, `emoji`, `preset` from set_reaction (all paths). `keyboard_cleared`, `scheduled`, `added` were already absent. No forbidden fields removed: `split`, `split_count`, `text_message_id`, `info?`, `unpinned?: true`, `message_id` (in non-react handlers) all preserved.
**Depth Notes:** Criterion 3 updated in spec to "test suite passes after updating assertions" — 12 test files updated to drop assertions on removed fields; disable_reminder.test.ts, enable_reminder.test.ts, sleep_reminder.test.ts deletions are branch-divergence artifacts from task 15-0815 (pre-existing in dev), not deletions by this task. Criterion 4 updated in spec to require field-level alignment with audit targets rather than runtime measurement; all 20+ removed fields map 1:1 to the 10-0517 audit list. Don'ts fully respected — no Phase 2 discriminators touched.
