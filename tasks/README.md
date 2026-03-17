# Tasks

Structured task tracking for bugs, features, and big-picture items. Works like a Kanban board.

## Workflow Stages

| Folder | Purpose | Who touches it |
| --- | --- | --- |
| `1-draft` | Ideas and rough notes — not yet scoped or committed to | Overseer writes |
| `2-queued` | Scoped and ready to work on — available for pickup | Overseer writes, agents pick up |
| `3-in-progress` | Claimed and in progress — owned by the agent who moved it here | Owning agent only |
| `4-completed` | Done — awaiting review by overseer/human | Owning agent moves here |

## How Agents Pick Up Work

1. Browse `2-queued/` for available tasks.
2. Move the task file to `3-in-progress/` — this claims ownership.
3. Work the task (TDD, implement, test, lint, build).
4. Update the task document with a **completion report** (see [AGENTS.md](AGENTS.md)).
5. Move the task to `4-completed/` when done.
6. Report results to the overseer.

## Archive

Once the overseer/human reviews a completed task and approves it, they move it into a **dated subfolder** within `4-completed/` (e.g., `4-completed/2026-03-17/`). This keeps the root of `4-completed/` clean — only unreviewed items sit there.

See [AGENTS.md](AGENTS.md) for full agent instructions.

## Task Document Format

Each task is a single `.md` file with a **three-digit priority prefix** — lower number = higher priority.

- `000`–`099` — Critical / blocking
- `100`–`199` — High priority
- `200`–`299` — Medium priority
- `300`–`499` — Normal
- `500`–`999` — Low / someday

Example: `100-voice-salute-bug.md`, `500-smart-routing.md`

Files move between folders as their status changes.
