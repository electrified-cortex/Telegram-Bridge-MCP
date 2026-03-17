# Agent Task Guide

Instructions for any agent (sub-agent or human-launched) picking up a task from this system.

## How It Works (Kanban)

Tasks flow through four stages: `1-draft` → `2-queued` → `3-in-progress` → `4-completed`.

- **The overseer** writes task documents and places them in `1-draft` or `2-queued`.
- **Worker agents** browse `2-queued`, pick a task, move it to `3-in-progress`, and take ownership.
- Once a task is in `3-in-progress`, the owning agent has exclusive control over it.
- When done, the owning agent **updates the task document** with a completion report and moves it to `4-completed`.
- The overseer or human reviews the completed task. If approved, it's moved into a dated subfolder (e.g., `4-completed/2026-03-17/`) to archive it.

## Picking Up a Task

1. Browse `2-queued/` — pick a task that matches your capabilities.
2. **Move the file** from `2-queued/` to `3-in-progress/` — this claims ownership. No one else will touch it.
3. Read the task document thoroughly — it contains the description, context, and acceptance criteria.
4. Understand the codebase context before making changes. Use the existing test files and docs as reference.
5. **Never guess.** If the task document is unclear, escalate back to the overseer.

## Workflow

1. **Claim** the task by moving it to `3-in-progress/`.
2. **Write tests first** (TDD). Every change must have tests that fail before the fix and pass after.
3. **Implement** the fix or feature.
4. **Run the full test suite** — `pnpm test`. All tests must pass. No exceptions.
5. **Run the linter** — `pnpm lint`. Zero errors.
6. **Run the build** — `pnpm build`. Must compile clean.
6. **Update the task document** with a completion report (see below).
7. **Move the task** to `4-completed/` when done.
8. **Report results** back to the overseer with: what changed, test count, any concerns.

## Completion Report

Before moving a task to `4-completed/`, **append a `## Completion` section** to the task document:

```markdown
## Completion

**Agent:** [your session name]
**Date:** YYYY-MM-DD

### What Changed
- List of files modified and what was done

### Test Results
- Tests added: X new tests
- Total tests: Y (all passing)
- Coverage notes (if relevant)

### Findings
- Any bugs discovered, edge cases noted, or concerns raised
- Items that may need follow-up

### Acceptance Criteria Status
- [x] Criterion 1
- [x] Criterion 2
- [ ] Criterion 3 (explain why not met, if any)
```

This is mandatory. A task moved to `4-completed/` without a completion report is incomplete.

## Rules

- **No commits or pushes.** Only the overseer commits. You write code and run tests.
- **No changelog edits.** The overseer handles changelog entries at commit time.
- **In-progress = owned.** Once you move a task to `3-in-progress`, it's yours. No one else touches it. If you need to escalate, report back — don't abandon it silently.
- **Scope discipline.** Only change what the task requires. No drive-by refactors, no extra features.
- **If tests break, stop.** Don't push through broken tests. Fix or escalate.

## Codebase Quick Reference

- **Language:** TypeScript, ESM, Node 22+
- **Test framework:** Vitest
- **Package manager:** pnpm
- **Source:** `src/` — the MCP server
- **Tools:** `src/tools/` — individual MCP tool implementations
- **Tests:** co-located with source (e.g. `foo.ts` → `foo.test.ts`)
- **Build:** `pnpm build` (tsc → `dist/`)
- **Test:** `pnpm test` (vitest)
- **Lint:** `pnpm lint` (eslint)

## Task Document Structure

Each task `.md` file should contain:

- **Type** — Bug, Feature, Testing, etc.
- **Description** — What needs to happen
- **Observed/Expected Behavior** (for bugs)
- **Code Path** — Relevant files and functions
- **Investigation** — What's been tried so far
- **Next Steps** — Specific actionable items
- **Acceptance Criteria** — How to know it's done
