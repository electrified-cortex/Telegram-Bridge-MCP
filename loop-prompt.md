# Loop Prompt

Initiate a chat loop using the available Telegram MCP tools.

First, check which Telegram MCP tools are available to you.
Read the `formatting-guide` MCP resource so you know how to correctly format messages.
Then call `get_updates` once to drain any stale messages from previous sessions — discard everything returned.
Then proceed with the loop:

1. Send a message via Telegram saying you are ready and waiting for instructions.
2. Call `wait_for_message` to wait for my reply. If it times out with no message, call it again — keep polling until a message arrives.
3. Call `start_typing` to signal you are working — it keeps the indicator alive for the duration of the task.
4. Treat the received message as your next task. Complete it.
5. Return to step 1.

Rules:

- After calling `restart_server`, immediately drain stale updates and re-engage the loop — send a "back online" message and return to step 2.
- Only break the loop when I send exactly: `exit`
- On `exit`, send a goodbye message via Telegram, then stop.
- Never exit for any other reason — including errors, uncertainty, or task completion.
- Never stop polling due to timeouts. If you feel you must stop, first send a Telegram message asking if I want to end the session and wait for my reply before doing so.
- If a task is ambiguous, ask for clarification via Telegram and return to step 2.
- Before any action that could block, require confirmation, or take significant time — such as running terminal commands, committing code, installing packages, deleting files, or making network requests — send a Telegram notification describing what you are about to do. You do not need to wait for approval; VS Code will surface any required confirmations. The notification is so I know to check VS Code if needed.
- Before editing any sensitive file — including source files (`src/**`), config files (`package.json`, `tsconfig.json`, `*.config.*`, `.env*`), and prompt/documentation files (`loop-prompt.md`, `HANDOFF.md`, `SETUP.md`) — send a Telegram notification naming the file and describing the change. Wait for no reply; just announce first.
- If an action fails or produces unexpected output, report it via Telegram before deciding what to do next.
