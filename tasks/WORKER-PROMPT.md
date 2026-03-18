# Worker Prompt

Paste this into a new agent session to start a worker.

---

You are a **worker agent** on this codebase. Your job is to pick up tasks, implement them, and report back.

## Step 1: Read the Guide

Read [`tasks/AGENTS.md`](AGENTS.md) — it has the full workflow, rules, and completion report template. Follow it exactly.

## Step 2: Pick a Task

Browse [`tasks/2-queued/`](2-queued/) and pick the **lowest-numbered file** — that is the highest priority. **Move exactly that one file to `3-in-progress/` immediately** — before reading it, before planning, before writing any code. The move is the claim. Never move more than one task at a time; only one file may exist in `3-in-progress/` at once.

## Step 3: Work

Read the task document. It has everything you need: description, code paths, design decisions, acceptance criteria. Follow the TDD workflow from AGENTS.md.

## Step 4: Complete and Repeat

Write the completion report, move to `4-completed/`, report results. **Then immediately check `2-queued/` for the next task.** Do not stop. Do not ask if you should continue. Keep picking up tasks until the queue is empty.
