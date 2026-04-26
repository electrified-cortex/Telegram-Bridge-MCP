---
id: 10-799
title: Rewrite help("compacted") — TMCP-scoped, agent-agnostic
priority: 10
status: queued
origin: operator directive 2026-04-24
---

# Rewrite help("compacted") — TMCP-scoped, agent-agnostic

Current content (verbatim):

```text
You just lost conversational context. Follow these steps:

1. Read your agent file (CLAUDE.md) — it has your identity and routing pointers.
2. Read startup-context.md in your agent folder — full operating procedures.
3. Read recovery-context.md in your agent folder — session state and invariants.
4. Test Telegram: dequeue(max_wait: 0, token) — drain any pending messages.
5. Check session memory file for token and SID.
6. If token is lost: action(type: 'session/reconnect', name: '<your_name>').
7. Resume your dequeue loop or last task.

Key: your agent file is the router. It tells you where everything else lives.
```

Problem

Mixes agent-harness concerns (CLAUDE.md, startup-context, recovery-context) with TMCP/Telegram recovery. Agent file layout just moved to `context/startup.md` + `context/refresh.md` + `context/recovery.md` — the help text is already stale. Making it reference agent-specific files means every agent layout change breaks this MCP help topic.

Direction

Strip to TMCP scope only. The MCP bridge knows nothing about agent files. It should describe:

1. Telegram-side session recovery — token lives in your memory if previously configured; if absent, `session/reconnect` or `session/start`.
2. Verify bridge link with `dequeue(max_wait: 0)`.
3. Cross-links to other help topics the agent may want after compaction: `help('guide')`, `help('send')`, `help('reactions')`, `help('presence')`, `help('reminders')`.

The agent harness injects the agent-specific recovery checklist. MCP shouldn't duplicate it.

Acceptance (pending refinement)

- Update help topic content in TMCP source
- No mention of `CLAUDE.md`, `startup-context.md`, `recovery-context.md`, or `context/*.md`
- Includes pointers to other help topics for smart post-compaction orientation
- Matches tone of other help topics (terse, scannable)

Reversal: single-file content change; revert via git.
