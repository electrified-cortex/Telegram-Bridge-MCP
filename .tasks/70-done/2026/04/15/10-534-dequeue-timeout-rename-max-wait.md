---
id: "10-534"
title: "Rename dequeue timeout parameter to max_wait"
status: draft
priority: 10
created: 2026-04-14
tags: [tmcp, dequeue, ux, agent-confusion]
source: Operator (voice)
---

# Rename Dequeue timeout → max_wait

## Objective

Rename the `timeout` parameter on `dequeue` to `max_wait` to reduce agent confusion. Agents consistently misuse `timeout` as a polling interval — shortening it to "check back sooner" — instead of understanding that dequeue is a blocking long-poll where the session default handles wait time.

## Context

Nearly every agent exhibits this pattern: setting short timeouts (15s, 30s, 60s) when waiting for background work or trying to stay "responsive." The parameter name "timeout" implies something that needs to be managed. `max_wait` better communicates "this is the longest you'll wait before the call returns empty — you almost never need to set it."

## Changes

1. Rename `timeout` parameter to `max_wait` in dequeue tool schema
2. Update `help(topic: 'dequeue')` — add clear guidance: "Omit max_wait. The session default handles blocking. Only use max_wait: 0 for drain loops."
3. Update tool description to emphasize: "Do not shorten max_wait to poll for other events. Background agents notify you independently."
4. Consider whether `timeout: 0` drain case should become a separate `drain: true` flag for clarity

## Acceptance Criteria

- [x] Parameter renamed from `timeout` to `max_wait`
- [x] Help topic updated with anti-pattern guidance
- [x] Tool description updated
- [x] Existing agent docs/skills referencing `dequeue(timeout: ...)` updated
- [x] Backward compat: `timeout` still accepted as alias (deprecation warning optional)

## Completion

- **Branch:** `10-534`
- **Commit:** `4273aef`
- **Worktree:** `Telegram MCP/.worktrees/10-534`
- **Completed:** 2026-04-15

`max_wait` is now the primary parameter; `timeout` kept as a schema-level alias (resolved via `max_wait ?? timeoutAlias` in handler). Zod schema updated with new descriptions; error messages say `max_wait`; force description updated; first-dequeue hint updated; help topic updated (rule 5 now says "Omit max_wait — session default handles blocking"). 5 new tests covering max_wait, alias fallback, and precedence. Build passes, 2224 tests pass (109 files).

**Agent/skill docs updated (staged, pending Curator commit):**
- `.agents/agents/worker/spec.md`, `startup-context.md`, `task-acceptance-context.md`, `skills/task-execution/SKILL.md`
- `.agents/agents/curator/spec.md`
- `.agents/skills/telegram-bridge-mcp/telegram-mcp-dequeue-loop/SKILL.md`
- `.agents/skills/telegram-bridge-mcp/telegram-mcp-graceful-shutdown/SKILL.md` + `SKILL.spec.md`
- `.agents/skills/telegram-bridge-mcp/telegram-mcp-post-compaction-recovery/SKILL.md` + `SKILL.spec.md`
- `.agents/subagents/agentic-workflow-auditor.agent.md`
