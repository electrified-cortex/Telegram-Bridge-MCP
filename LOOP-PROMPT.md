# Loop Prompt

Initiate a chat loop using the available Telegram Bridge MCP tools.

First, check which Telegram Bridge MCP tools are available to you.
Call `get_agent_guide` to load the agent behavior guide — this tells you how to communicate with the user, which tools to use, and all behavioral conventions. The same content is also available as the `telegram-bridge-mcp://agent-guide` resource.
Read the `formatting-guide` MCP resource so you know how to correctly format messages.
Then call `get_updates` once to drain any stale messages from previous sessions — discard everything returned.
Then proceed with the loop:

1. Send a message via Telegram saying you are ready and waiting for instructions.
2. Call `wait_for_message` to wait for my reply. The default timeout is 300 s (5 min), optimized to minimize token usage during idle polling. If it times out with no message, call it again — keep polling until a message arrives.
3. Call `start_typing` to signal you are working — it keeps the indicator alive for the duration of the task.
4. Treat the received message as your next task. Complete it.
5. Return to step 1.

This is the **Telegram Bridge MCP** repo — a Node.js/TypeScript MCP server. Changes here directly affect the running MCP server and its tools. Apply the following rules carefully.

Rules:

- After calling `restart_server`, immediately drain stale updates and re-engage the loop — send a "back online" message and return to step 2.
- Only break the loop when I send exactly: `exit`
- On `exit`, send a goodbye message via Telegram, then stop.
- Never exit for any other reason — including errors, uncertainty, or task completion.
- Never stop polling due to timeouts. If you feel you must stop, first send a Telegram message asking if I want to end the session and wait for my reply before doing so.
- If a task is ambiguous, ask for clarification via Telegram and return to step 2.

## Pre-action announcements

Before **any** of the following, send a silent `notify` (title + brief description) via Telegram. Do not wait for a reply; just announce first.

**File edits — announce before editing any of these:**

- Any source file: `src/*.ts`, `src/tools/*.ts`
- Any test file: `src/*.test.ts`, `src/tools/*.test.ts`
- Config/build files: `package.json`, `tsconfig.json`, `vitest.config.ts`, `pnpm-lock.yaml`, any `*.config.*` or `.env*`
- All documentation and prompt files: `LOOP-PROMPT.md`, `BEHAVIOR.md`, `SETUP.md`, `DESIGN.md`, `FORMATTING.md`

**MCP API surface — extra scrutiny:**

- Any edit to a file under `src/tools/` changes which MCP tools are available and what they do. Note this in the announcement and confirm the tool name and what behavior is changing.

**Commands — announce before running:**

- `pnpm build` — rebuilds the server; note what triggered the build
- `pnpm test` or any `vitest` invocation — note which tests and why
- Any `git` command (commit, push, branch, reset, etc.) — include the full command and intent
- Installing or removing packages (`pnpm add`, `pnpm remove`)
- Deleting any file

## Error handling

- If any command exits with a non-zero code, or produces unexpected output, report the full error via Telegram before deciding what to do next.
- If a build or test fails after an edit, do not attempt further edits until you have reported the failure and received direction.
