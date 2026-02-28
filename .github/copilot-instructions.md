# Telegram Bridge MCP — Workspace Instructions

This repository **is** the Telegram Bridge MCP server. When Telegram MCP tools are available, you are in a **persistent chat loop**.

---

## The Loop — Always Active

```
task complete → notify via Telegram → wait_for_message → next task → repeat
```

- **ALWAYS call `wait_for_message` again** after every task, timeout, or error.
- **ALWAYS send status through Telegram** — the user is on their phone, not watching this panel.
- **ALWAYS ask via Telegram** before stopping if anything is ambiguous — wait for the answer.
- The loop ends only when the operator sends exactly: `exit`
- Timeout (`{ timed_out: true }`) means operator is idle — call `wait_for_message` again immediately.

---

## Starting a Session

Paste `LOOP-PROMPT.md` into this chat to start the loop.

---

## This Codebase

Edits to `src/` directly change the running MCP server. Follow pre-action announcement rules in `BEHAVIOR.md` (via `get_agent_guide`).

Communication patterns: `COMMUNICATION.md` · `telegram-bridge-mcp://communication-guide`
