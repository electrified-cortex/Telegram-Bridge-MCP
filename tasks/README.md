# Tasks

Structured task tracking for bugs, features, and big-picture items. Works like a Kanban board with two roles: **overseer** (plans, reviews, manages git) and **workers** (implement, test, report).

## Workflow Stages

| Folder | Purpose | Who touches it |
| --- | --- | --- |
| `0-backlog` | Back-burner ideas — acknowledged but not prioritized for near-term work | Overseer writes |
| `1-draft` | Ideas and rough notes — not yet scoped or committed to | Overseer writes |
| `2-queued` | Scoped and ready to work on — available for pickup | Overseer writes, workers pick up |
| `3-in-progress` | Claimed and in progress — **only ONE task at a time**; owned by the claiming worker | Owning worker only |
| `4-completed` | Done — awaiting review by overseer/human | Owning worker moves here |

## Task Flow

```text
overseer writes spec → 1-draft
overseer verifies & queues → 2-queued
worker claims (move file) → 3-in-progress
worker completes (TDD, report) → 4-completed
overseer reviews → 4-completed/YYYY-MM-DD/ (archived)
```

## Moving Task Files

> **MOVE means MOVE — never copy.** The source file must not exist after the operation. A file in two folders at once breaks the entire system.

**Workers** use filesystem moves only:

```bash
mv tasks/2-queued/my-task.md tasks/3-in-progress/my-task.md
```

**Overseers** may use `git mv` (preserves history) or filesystem moves:

```bash
git mv tasks/4-completed/my-task.md tasks/4-completed/2026-03-18/my-task.md
```

**Never** use `create_file` to write a copy into a new folder. **Never** read content and write it to a new path. After any move, verify: file exists at destination, file does NOT exist at source.

## Return to Draft

If a worker finds a task **under-specified** — ambiguous scenarios, wrong file paths, open design questions posing as test specs, or missing setup mechanics — they must:

1. Prepend a `## ⚠️ Needs Clarification Before Implementation` section listing every blocker.
2. Add a `## Progress So Far` section documenting any work already done — files created, tests written, approach taken. A different worker may pick this up next.
3. Move the task back to `1-draft/`.
4. Report the rejection to the overseer.

This is quality control, not failure. The overseer rewrites with concrete answers from source code investigation before re-queuing.

## Priority Scheme

Each task is a single `.md` file with a **three-digit priority prefix** — lower number = higher priority.

| Range | Priority |
| --- | --- |
| `000`–`099` | Critical / blocking |
| `100`–`199` | High |
| `200`–`299` | Medium |
| `300`–`499` | Normal |
| `500`–`999` | Low / someday |

Workers always pick the **lowest-numbered** file from the queue.

## Task Document Structure

Each task `.md` file should contain:

- **Type** — Bug, Feature, Testing, etc.
- **Description** — What needs to happen
- **Observed/Expected Behavior** (for bugs)
- **Code Path** — Relevant files and functions
- **Acceptance Criteria** — How to know it's done

## Completion Report

Workers append a `## Completion` section before moving to `4-completed/`:

```markdown
## Completion

**Agent:** [session name]
**Date:** YYYY-MM-DD

### What Changed
- List of files modified and what was done

### Test Results
- Tests added: X new tests
- Total tests: Y (all passing)

### Findings
- Bugs discovered, edge cases, or follow-up items

### Acceptance Criteria Status
- [x] Criterion 1
- [x] Criterion 2
```

A task without a completion report is incomplete and will be sent back.

## Role-Specific Instructions

- **Workers:** See [WORKER-PROMPT.md](WORKER-PROMPT.md)
- **Overseers:** See [OVERSEER-PROMPT.md](OVERSEER-PROMPT.md)
