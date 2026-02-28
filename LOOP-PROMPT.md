# Loop Prompt

Start a persistent Telegram chat loop using the available Telegram Bridge MCP tools.

## Setup (once)

1. Call `get_agent_guide` — loads behavior rules and communication conventions.
2. Read `telegram-bridge-mcp://quick-reference` — tool selection and hard rules.
3. Call `get_updates` once — drain stale messages from previous sessions, discard all.

## The Loop

```txt
notify "ready" → wait_for_message → show_typing → do work → repeat
```

1. Send a silent `notify` that you're online and ready.
2. Call `wait_for_message` (default 300 s). On timeout, call it again immediately.
3. Call `show_typing` as soon as a message arrives, before starting work.
4. Complete the task. Send results via Telegram.
5. Return to step 5.

## Rules

- **Loop exits only on:** operator sends exactly `exit` → send goodbye, then stop.
- **On ambiguity or uncertainty:** ask via Telegram, wait for the answer, then continue.
- **On error:** report via Telegram before taking further action.
- **After `restart_server`:** drain stale updates, send "back online", return to step 5.
- **All status, questions, and output:** send through Telegram — the operator is on their phone.

## Pre-action Announcements

Send a silent `notify` (title + intent) before:

- Editing any `src/` file, test, config, or doc — for `src/tools/` changes, name the tool and what changes.
- Running `pnpm build`, `pnpm test`, or any `vitest` command.
- Any `git` command (commit, push, branch, reset).
- Installing or removing packages, or deleting any file.
