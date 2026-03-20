# Telegram Bridge MCP — Workspace Instructions

This repository **is** the Telegram Bridge MCP server. Edits to `src/` directly change the running MCP server.

## Starting a Session

Paste `LOOP-PROMPT.md` into this chat, or select the **Overseer** or **Worker** agent from the agents dropdown.

## Agent Roles

Agent-specific identity, behavior, reminders, and communication rules are defined in `.github/agents/`:

- **Overseer** (`.github/agents/overseer.agent.md`) — task board manager, operator liaison
- **Worker** (`.github/agents/worker.agent.md`) — task executor, implements and tests

## Changelog Maintenance

**Every commit that changes behavior must update [changelog/unreleased.md](../changelog/unreleased.md).**

- [Keep a Changelog](https://keepachangelog.com) format
- Categories: `Added`, `Changed`, `Fixed`, `Removed`, `Security`, `Deprecated`
- One line per change, past tense
- Include in the same commit as the code change — never a separate commit

## Token Economy

Minimize token use at every level:

- **Messages**: Concise. No filler.
- **Documentation**: Tables over prose, bullets over paragraphs.
- **Tool calls**: Batch reads, no redundant searches.
- **Commit messages**: One line, conventional format.