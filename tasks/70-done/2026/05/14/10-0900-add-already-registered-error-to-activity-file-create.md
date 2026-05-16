---
created: 2026-05-12
status: 10-drafts
priority: 10-0900
source: operator-call-2026-05-12
repo: Telegram MCP
type: Bug
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
related: 15-0898 15-0899
target_branch: release/7.5
status: completed
claimant: foreman
claimed_at: 2026-05-14T23:17:00Z
worktree: .foreman-pod/.worktrees/10-0900
spawn_task: baakdya96
completed_at: 2026-05-14T23:29:00Z
worker_commit: 8b2a9dda
---

# 10-0900 — Add ALREADY_REGISTERED error to activity/file/create

## Context

`activity/file/create` currently calls `replaceActivityFile` whether
or not a registration already exists for the session (verified in
`src/tools/activity/create.ts`, lines 26-43 for agent-supplied
paths and lines 47-66 for TMCP-generated paths). The replace
function atomically swaps the registration and, if the prior file
was TMCP-owned, unlinks the old physical file from disk. This
silent-replace behavior creates a class of bugs:

1. An agent that calls `create` unconditionally on every restart
   gets a brand-new TMCP-owned path, while any external watcher
   (Claude Code `Monitor`, PowerShell `FileSystemWatcher`,
   `inotifywait`) still pointed at the old path is now watching
   a phantom — the file was unlinked, no further mtime kicks
   reach the watcher, the agent silently loses its wake signal.
2. There is no purpose to having multiple registrations or
   creating a new file while a current one is working: TMCP only
   touches the current registration. Replace is destructive
   without benefit when the agent did not intend to swap.
3. Operator directive 2026-05-12: "if there already is a monitor
   file, it needs to fail. Tell the agent there is an existing
   monitor file here — they can monitor it, delete it and
   reconnect, or at least be warned. I don't see the purpose of
   having multiple."

## Objective

Make `activity/file/create` fail with a structured error when a
registration already exists for the calling session, returning
the existing file path and explicit guidance on the three valid
follow-up actions: keep the existing file (call `activity/file/get`
to confirm and wire a watcher), swap to a different path
(call `activity/file/edit`), or remove the existing registration
first (call `activity/file/delete`, then re-call create). No
silent replace.

## Acceptance Criteria

1. `activity/file/create` returns error code `ALREADY_REGISTERED`
   with HTTP-style structured shape `{ code, message, details }`
   when called for a session whose `getActivityFile(sid)` returns
   a non-undefined entry.
2. The error `details` object includes `file_path` (the existing
   registered path) and `tmcp_owned` (boolean from existing entry).
3. The error `message` text names the three valid follow-up
   actions: `activity/file/get`, `activity/file/edit`,
   `activity/file/delete`. No verbatim string requirement — the
   message must be grammatical English that mentions each by full
   action path.
4. When the error fires, NO mutation occurs: existing registration
   is preserved, existing physical file is preserved, no debounce
   timer is canceled.
5. `activity/file/edit` (which replaces an existing registration
   by contract) is unaffected — it remains the canonical swap
   path and continues to call `replaceActivityFile`.
6. Existing behavior is preserved when no registration exists:
   `create` with no prior entry proceeds normally and returns
   `{ file_path, hint }` as before.
7. Regression test in `src/tools/activity/file-state.test.ts`
   (or sibling test file) asserts: (a) first `create` succeeds,
   (b) second `create` (same session, with or without
   `file_path` arg) returns the `ALREADY_REGISTERED` error,
   (c) the existing registration is unchanged after the failed
   create, (d) `edit` works against the existing registration
   after a failed create.
8. `help('activity/file')` updated to document the
   `ALREADY_REGISTERED` error: when it fires, what the response
   shape looks like, and the three follow-up actions.
9. No new MCP tool, no new action path. Response shape changes
   are additive (new error code) and do not modify success
   responses.

## Scope boundary

- This task does NOT change `activity/file/edit` semantics.
  Edit remains the canonical swap path.
- This task does NOT add a `force: true` override flag on
  `create`. Operator directive is fail-or-warn; we choose fail
  for clarity. If a `force` override is wanted later, that is a
  separate task.
- This task does NOT change `activity/file/delete` semantics.
- This task does NOT modify the kick / touch / debounce state
  machine.
- This task does NOT change agent recovery flows. The new error
  is the surface that future agent-side recovery skills will key
  off; agent-side changes are separate per-pod tasks.

## Delegation

Executor: Worker / Reviewer: Curator

## Priority

Priority: 10 — high

## Affected Files / Repos

- `Telegram MCP/src/tools/activity/create.ts` — branch on
  `getActivityFile(sid)` before mutation.
- `Telegram MCP/src/tools/activity/file-state.ts` — no change
  expected; existing `getActivityFile` accessor is sufficient.
- `Telegram MCP/src/tools/activity/file-state.test.ts` — add
  the regression tests in AC7.
- `Telegram MCP/docs/help/activity/file.md` — document the
  `ALREADY_REGISTERED` error and the three follow-up paths.

## Blockers

None.

## Rollback procedure

Not a governance-path change (no `hooks/`, no `.claude/`, no
agent spec). Rollback is `git revert <merge-commit>` on the
feature branch's merge into `master`. `create` returns to silent
replace behavior; existing callers that assume replace continue
to work, with the failure-mode this task eliminates returning.

## Notes

- Priority bumped to `10 — high` rather than `15 — normal`
  because this is a correctness fix that prevents a class of
  silent-failure bugs (orphaned watcher on phantom file), and
  the related onboarding tasks `15-0898` and `15-0899` assume
  agents will start to consume the new contract.
- `type: Bug` because current behavior produces a wrong outcome
  (silent destructive replace) under a real call pattern (agent
  re-creates on restart). Not `Feature` — this fixes a defect,
  not adds capability.
- `agent_type: Worker` — small, well-scoped change: one branch
  in one handler, structured error shape, tests, doc update.
- `model_class: sonnet-class` — touches error semantics and
  test snapshots; benefits from careful schema discipline.
- `reasoning_effort: medium` — small surface, but the test
  matrix and the help-doc cross-link require care.
- Alternative semantic considered (operator, 2026-05-12): the
  action could become idempotent `get-or-create` — if a
  registration already exists, return the existing entry as a
  success (with a `pre_existing: true` flag) instead of failing.
  This eliminates the orphan-watcher class without forcing
  agents to handle an error path. Implementer should weigh
  fail-with-guidance vs idempotent-get-or-create before
  committing; either satisfies the no-silent-destructive-replace
  constraint.

## Verification

**Verdict:** APPROVED
**Date:** 2026-05-14
**Verifier:** Dispatch sub-agent (fresh-eyes, read-only)
**Cherry-pick commit:** `55d13cd8` on `release/7.5`

All 9 acceptance criteria CONFIRMED with citations:
- AC1: ALREADY_REGISTERED error with `{ code, message, details }` — `create.ts:25-39`
- AC2: `details.file_path` + `details.tmcp_owned` — `create.ts:34-38`
- AC3: message names all three action paths — `create.ts:29-33`
- AC4: no mutation on error path (early return) — `create.ts:25-39`; test AC7c
- AC5: `edit.ts` unaffected — no diff; test AC7d
- AC6: normal path preserved when no registration — `create.ts:25-26`; test AC7a
- AC7: regression suite (a–d) — `file-state.test.ts:578-634`; 29/29 pass
- AC8: help doc updated — `docs/help/activity/file.md:78-95`
- AC9: additive only, no new tool/action
