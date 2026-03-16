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