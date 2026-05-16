---
id: "15-0899"
created: 2026-05-12
status: 10-drafts
priority: 15
source: operator-call-2026-05-12
repo: Telegram MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
related: 15-0898
target_branch: dev
---

# 15-0899 — Document canonical Monitor recipe for activity-file kick

## Context

Agents in this workspace consume TMCP's activity-file kick via Claude
Code's `Monitor` tool (and equivalents on other harnesses). Today
`help('activity/file')` documents three watcher patterns — bash
stat-poll, PowerShell `FileSystemWatcher`, Linux `inotifywait` — but
does NOT specify which one Claude Code agents should use, and does
NOT provide a single literal command string an agent can paste into
`Monitor` verbatim. Observed consequences (2026-05-11, 45-minute
recovery failure): a post-compaction agent improvised six broken
variants — `tail -F`, mtime-poll with `jq` filter, mtime-poll with
self-stop event noise, and others — because no canonical recipe was
available at the point of use. The bash stat-poll pattern from the
help topic IS the right one for Claude Code's `Monitor` (which runs
its `command` in bash), but the recipe is buried in a multi-section
doc and the agent has to assemble path interpolation, escape quoting,
and Monitor parameter choices on its own. TMCP is the authority on
the kick contract; TMCP should publish the one canonical Monitor
recipe so no agent improvises.

## Objective

Publish ONE canonical `Monitor` recipe for Claude Code agents
consuming the TMCP activity-file kick — literal bash command string,
ready to paste verbatim — and surface that recipe from TMCP's
onboarding messages so a fresh-context or post-compaction agent reads
the literal command and cannot improvise. Reduce six-variants-of-broken
to one documented contract.

## Acceptance Criteria

1. `help('activity/file')` response contains a section titled
   `## Canonical Monitor recipe (Claude Code)` that holds a single
   bash command using `stat -c%Y` mtime polling at 1-second cadence,
   emitting one line per change in the literal form
   `kick @ <unix-seconds>`.
2. The recipe section also names the `Monitor` parameters to use:
   `persistent: true`, `description` field text, and explicit
   instruction that `timeout_ms` is ignored when `persistent: true`
   (so it can be omitted or set to any valid value without effect).
3. The recipe section explicitly lists the failure modes that the
   recipe avoids: `tail -F` not working on mtime-only changes,
   `jq` not being installed in default bash, content-of-file vs mtime
   confusion, and persistent-flag-vs-timeout confusion.
4. `action(type: 'session/start')` and
   `action(type: 'session/reconnect')` responses include a
   `monitor_recipe` field whose value is the same literal bash command
   string as in the help topic (single source of truth — both sites
   read from one shared constant).
5. `help('compacted')` response includes a one-sentence directive
   pointing post-compaction agents at `help('activity/file')` for
   the canonical Monitor recipe AND at `session/start` /
   `session/reconnect` for the `monitor_recipe` field.
6. The recipe command is path-parameterized: the agent must substitute
   its own `activity_file` path. The help topic shows the exact place
   to substitute, using a placeholder token like `<ACTIVITY_FILE>`
   or `$ACTIVITY_FILE`, and notes that `action(type: 'activity/file/get')`
   returns the path to use.
7. Regression test under `src/tools/help.test.ts` asserts the canonical
   recipe section appears in `help('activity/file')` output and
   contains the literal substrings `stat -c%Y`, `kick @`, and
   `persistent`.
8. Regression test asserts the `monitor_recipe` field appears in
   `session/start` and `session/reconnect` responses and equals the
   shared constant.
9. The recipe lives as a single shared constant in source (e.g.
   `src/tools/activity/canonical-recipe.ts`) so help text and
   response fields cannot drift.
10. Documentation cross-link: `tmcp-onboarding-activity-file-monitor-wiring.md`
    in `tasks/10-drafts/` updated to reference this task ID (or
    closed-out if this task supersedes it).

## Scope boundary

- This task does NOT add new watcher patterns for other harnesses
  (PowerShell-only agents, VS Code Continue, etc.). Those remain
  documented as alternates in `help('activity/file')`, unchanged.
- This task does NOT solve the "Monitor process dies on compaction"
  Claude Code limitation — that is a CLI-runtime behavior outside
  TMCP. This task ONLY ensures the agent has the literal re-arm
  recipe at the point of need.
- This task does NOT modify any agent's `recovery.md` /
  `refresh.md` / `startup.md`. Each agent pod updates its own
  recovery flow to consume the `monitor_recipe` field — separate
  follow-up tasks per pod.
- This task does NOT change kick semantics (mtime touch, debounce,
  in-flight-dequeue guard).
- No new MCP tool, no new action path beyond response-shape additions.

## Delegation

Executor: Worker / Reviewer: Curator

## Priority

Priority: 15 — normal

## Affected Files / Repos

- `Telegram MCP/src/tools/activity/canonical-recipe.ts` (new, shared
  constant)
- `Telegram MCP/src/tools/help.ts` (load constant into topic content)
- `Telegram MCP/src/tools/help.test.ts` (regression assertions)
- `Telegram MCP/src/tools/session/start.ts` — add `monitor_recipe`
  field
- `Telegram MCP/src/tools/session/reconnect.ts` — same
- `Telegram MCP/docs/help/activity/file.md` (recipe section)
- `Telegram MCP/docs/help/compacted.md` (pointer sentence)
- `Telegram MCP/tasks/10-drafts/tmcp-onboarding-activity-file-monitor-wiring.md`
  (cross-link or closure)

## Blockers

None.

## Rollback procedure

Not a governance-path change (no `hooks/`, no `.claude/`, no agent
spec). Rollback is `git revert <merge-commit>` on the feature
branch's merge into `master`. Onboarding messages and help topics
return to current text; agents fall back to assembling the recipe
themselves (current behavior, with the failure mode this task is
designed to eliminate).

## Notes

- Sister task `15-0898` defines the pod-memory convention for
  compaction-survivable state (token, etc.). This task is the
  same pattern applied to the Monitor recipe: TMCP publishes one
  canonical literal, agents consume verbatim.
- The canonical recipe — already tested live 2026-05-12 in the
  current Curator session — is approximately:
  `f="<ACTIVITY_FILE>"; prev=$(stat -c%Y "$f" 2>/dev/null); while true; do cur=$(stat -c%Y "$f" 2>/dev/null); if [ "$cur" != "$prev" ]; then echo "kick @ $cur"; prev=$cur; fi; sleep 1; done`.
  Worker is free to refine wording while preserving the contract
  (stat-poll on mtime, 1-second cadence, `kick @ <seconds>` output).
- `agent_type: Worker` — mechanical edits: new file, edit help, add
  response fields, add tests, write doc section.
- `model_class: sonnet-class` because response-shape changes and test
  snapshots demand schema discipline.
- `reasoning_effort: medium` — careful, not architectural.

## Verification

APPROVED — All 10 criteria confirmed. Pass 3 added `src/tools/activity/canonical-recipe.test.ts`: a real-fs test (no mocked `readFileSync`) that reads `docs/help/activity/file.md` from disk and asserts it contains the exact `CANONICAL_MONITOR_RECIPE` value. This is the drift guard that satisfies criterion 9 — if either the constant or the markdown file is updated independently, this test fails. 3029 tests pass. Squash-merged as `e641e596`.
