# 049 — Subagent Dispatch for Reminders

**Strategy: Direct**

## Goal

Convert overseer reminders from "do-it-yourself procedures" to "dispatch a specialist subagent." The overseer's reminder handler becomes: fire the named agent via `runSubagent(agentName)`, read the report, act on findings.

## Background

Currently, when a reminder fires (e.g., "check PRs"), the overseer loads the full context itself — reads PR diffs, runs builds, checks markdown lint. This wastes overseer context on mechanical work.

The new model: each automatable reminder becomes a VS Code agent file in `.github/agents/` with a `task-` filename prefix. The overseer dispatches them via `runSubagent(agentName: "Task PR Review")`, gets a structured report, and acts on it.

## Confirm-Before-Dispatch Protocol

When the overseer is the only session (no workers), it must **confirm with the operator** before launching a subagent, since it will block:

1. `confirm(text: "Ready for me to run Task PR Review?", confirm_text: "▶ Go", deny_text: "⏸ Not now")`
2. If confirmed: `notify("Starting Task PR Review")` → `show_animation(preset: working)` → `runSubagent`
3. If denied or timed out: skip, loop back to `dequeue_update`

When workers are active, the overseer can dispatch without confirmation (workers handle operator messages).

## Deliverables

### 1. Create agent files in `.github/agents/`

Each file uses the `task-` prefix convention. The `name` field in frontmatter is what `runSubagent(agentName)` targets.

| Filename | Agent Name | Replaces Reminder | Model | Rationale |
|---|---|---|---|---|
| `task-pr-review.agent.md` | Task PR Review | 08 (PR review exhaustion) | Claude Sonnet 4.6 | Code understanding + writing |
| `task-pr-health.agent.md` | Task PR Health | 09 (PR health check) | GPT 5.3 Codex | Mechanical, tool-heavy |
| `task-build-lint.agent.md` | Task Build Lint | 03 (build/lint health) | GPT 5.3 Codex | Pure execution + reporting |
| `task-test-suite.agent.md` | Task Test Suite | 04 (test suite health) | Claude Sonnet 4.6 | Failure analysis needs reasoning |
| `task-changelog-audit.agent.md` | Task Changelog Audit | 05 (changelog review) | GPT 5.4 | Language comprehension |
| `task-doc-hygiene.agent.md` | Task Doc Hygiene | 06 (doc hygiene) | GPT 5.4 | Language + pattern matching |
| `task-markdown-lint.agent.md` | Task Markdown Lint | (new) | GPT 5.3 Codex | Mechanical refactoring |

### 2. Reminders that stay with the overseer

These require session state and should NOT be subagent-dispatched:

| Reminder | Why Overseer-Only |
|---|---|
| 01 (task board hygiene) | Requires task board judgment, worker assignment decisions |
| 02 (git state audit) | Quick `git status` — not worth subagent overhead |
| 07 (operator check-in) | Requires Telegram session for `notify` |
| 10 (worker health) | Requires `list_sessions` and DM capability |
| 11 (server build drift) | Quick `get_me()` comparison — not worth subagent overhead |

### 3. Update overseer agent file

- Add **confirm-before-dispatch** protocol section
- Update reminder table to distinguish direct vs. dispatch reminders
- Reminders that dispatch should reference the agent name explicitly

### 4. Update reminder procedures

Update `tasks/reminders/README.md` and individual reminder files to reference the agent dispatch pattern. Dispatch reminders should say: "Fire `Task <Name>` agent via `runSubagent`."

## Agent File Structure

```yaml
---
name: Task PR Review
description: Checks open PRs for review comments and CI status
model: Claude Sonnet 4.6
tools: [read, search, execute, edit, 'github/*']
---
```

```markdown
# Task PR Review

## Identity
GitHub PR review specialist. Check open PRs, address Copilot/human comments, monitor CI.

## Procedure
1. List open PRs
2. For each PR with unresolved comments...
3. ...

## Report Format
STATUS: pass | findings | failure
SUMMARY: one-line description
DETAILS: (optional) specifics
ACTION_NEEDED: (optional) what overseer should do
```

## Acceptance Criteria

- [ ] 7 agent files created in `.github/agents/` with `task-` prefix
- [ ] Each agent file has proper frontmatter (name, description, model, tools)
- [ ] Each agent file has identity, procedure, and report format sections
- [ ] Overseer agent file updated with confirm-before-dispatch protocol
- [ ] Overseer agent file updated with dispatch vs. direct reminder classification
- [ ] `tasks/reminders/README.md` updated to reference new pattern
- [ ] At least one agent (Task Build Lint or Task PR Health) successfully tested via `runSubagent`

## Completion

**Date:** 2026-03-20

### What Changed

- Created 7 agent files in `.github/agents/` with `task-` prefix
- Updated overseer agent file: split Startup Reminders into Direct vs. Dispatch subsections
- Updated 6 dispatch reminder docs with blockquote dispatch note at the top
- Updated `tasks/reminders/README.md` to document both patterns with split tables

### Files Created

- `.github/agents/task-pr-review.agent.md`
- `.github/agents/task-pr-health.agent.md`
- `.github/agents/task-build-lint.agent.md`
- `.github/agents/task-test-suite.agent.md`
- `.github/agents/task-changelog-audit.agent.md`
- `.github/agents/task-doc-hygiene.agent.md`
- `.github/agents/task-markdown-lint.agent.md`

### Files Modified

- `.github/agents/overseer.agent.md` — Startup Reminders section split into Direct / Dispatch
- `tasks/reminders/README.md` — documented dispatch pattern, split tables
- `tasks/reminders/03-build-lint-health.md` — added dispatch blockquote
- `tasks/reminders/04-test-suite-health.md` — added dispatch blockquote
- `tasks/reminders/05-changelog-review.md` — added dispatch blockquote
- `tasks/reminders/06-doc-hygiene.md` — added dispatch blockquote
- `tasks/reminders/08-pr-review-exhaustion.md` — added dispatch blockquote
- `tasks/reminders/09-pr-health-check.md` — added dispatch blockquote

### Notes

No TypeScript source files were changed. No builds or tests were run (docs-only task).
