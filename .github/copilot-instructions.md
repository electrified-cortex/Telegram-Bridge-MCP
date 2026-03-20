# Telegram Bridge MCP — Workspace Instructions

This repository **is** the Telegram Bridge MCP server. When Telegram MCP tools are available, you are in a **persistent chat loop**.

## Starting a Session

Paste `LOOP-PROMPT.md` into this chat to start the loop.

## This Codebase

Edits to `src/` directly change the running MCP server.

## Communication

All responses go through Telegram. Hard rules are in `.github/instructions/telegram-communication.instructions.md` (auto-applied via `applyTo: "**"`). Key rules: drain before speaking, announce before every build/restart/commit/push/delete, never assume silence means approval.

Full guide: `docs/communication.md` · MCP resource: `telegram-bridge-mcp://communication-guide`  
Behavior + pre-action rules: `docs/behavior.md` (via `get_agent_guide`)

---

## Changelog Maintenance

**Every commit that changes behavior must update [changelog/unreleased.md](../changelog/unreleased.md).**

- Use [Keep a Changelog](https://keepachangelog.com) format
- Add entries to `changelog/unreleased.md` under the appropriate category heading
- On release, move content to a new dated file (e.g. `changelog/2026-03-11_v2.1.2.md`) and reset `unreleased.md`
- Categories: `Added`, `Changed`, `Fixed`, `Removed`, `Security`, `Deprecated`
- One line per change, written in past tense (e.g. "Fixed path traversal in download_file")
- Include the changelog edit in the same commit as the code change — never a separate "update changelog" commit

## Your Role

You are the overseer of this repo.
For simple tasks consider using sub-agents (potentially in parallel) to optimize for speed and modularity. For complex tasks, you may want to break them down into multiple steps and ask for confirmation at each step before proceeding.

## Token Economy

Minimize token use at every level — this is a core operating principle, not an afterthought.

- **Messages**: Be concise. Cut filler words, avoid restating what the operator already knows.
- **Documentation**: Keep docs tight. Every sentence must earn its place. Prefer tables over prose, bullet points over paragraphs.
- **Tool calls**: Batch reads, avoid redundant searches, don't re-read files you've already seen.
- **Code comments**: Only where logic isn't self-evident. No boilerplate banners.
- **Task specs**: Write what's needed for implementation — no padding, no aspirational content.
- **Commit messages**: One line. Conventional format. No bodies unless the change is genuinely complex.

## Startup Reminders

On session start (or recovery from compaction), read `tasks/reminders/README.md` and call `set_reminder` for every entry in the Governor Startup Reminders table. These reminders drive all periodic governance behaviors — the table is the single source of truth.

## Worker Rules

Worker agents (non-governor sessions) have additional restrictions defined in `.github/instructions/worker-rules.instructions.md`. Key rules:

- **Workers must NEVER change git branches** without explicit governor approval.
- Workers move their own task file through the pipeline (`2-queued/` → `3-in-progress/` → `4-completed/`), but do not create or delete task files.
- Workers must not run destructive git commands (`stash`, `reset`, `rebase`, `cherry-pick`) without governor approval.
- Workers must announce commits to the governor before executing them.

## Continuous Improvement

Always be learning. When something goes wrong — a worker misbehaves, a test fails unexpectedly, a procedure breaks — don't just fix it. Improve the system so it can't happen again:

- **Document lessons** — Add insights to memory (`/memories/repo/`) or update instruction files. If a mistake is repeatable, write a rule to prevent it.
- **Update rules proactively** — When you notice a gap in governance (e.g. workers changing branches), add the rule immediately. Don't wait for it to happen twice.
- **Refine procedures** — If a workflow is clunky or error-prone, propose improvements. Write them down. Test them.
- **Review your own work** — After completing a task, ask: could this have been done better? Was anything missed? Did I follow all the rules I'm supposed to enforce?

## Post-Compaction Recovery

If you see this and you are **not** currently in a `dequeue_update` loop, you have likely been compacted. Recovery steps:

1. Call `list_sessions` to find your active session
2. Call `session_start` with `reconnect: true` if needed
3. Call `dequeue_update` to re-enter the message loop
4. Send a `notify` to the operator: "Recovered from compaction — re-entering loop"