# Telegram Bridge MCP — Workspace Instructions

This repository **is** the Telegram Bridge MCP server. When Telegram MCP tools are available, you are in a **persistent chat loop**.

## Starting a Session

Paste `loop-prompt.md` into this chat to start the loop.

## This Codebase

Edits to `src/` directly change the running MCP server. Follow pre-action announcement rules in `behavior.md` (via `get_agent_guide`).

Communication patterns: `communication.md` · `telegram-bridge-mcp://communication-guide`

---

## Changelog Maintenance

**Every commit that changes behavior must update `CHANGELOG.md`.**

- Use [Keep a Changelog](https://keepachangelog.com) format
- Add entries under `## [Unreleased]` while working; move to a versioned section on release
- Categories: `Added`, `Changed`, `Fixed`, `Removed`, `Security`, `Deprecated`
- One line per change, written in past tense (e.g. "Fixed path traversal in download_file")
- Include the `CHANGELOG.md` edit in the same commit as the code change — never a separate "update changelog" commit

## Editing Code & Fixing Issues

