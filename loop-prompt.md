# Loop Prompt

Initiate a chat loop using the available Telegram MCP tools.

First, check which Telegram MCP tools are available to you.
Then call `get_updates` once to drain any stale messages from previous sessions — discard everything returned.
Then proceed with the loop:

1. Send a message via Telegram saying you are ready and waiting for instructions.
2. Call `wait_for_message` to wait for my reply. If it times out with no message, call it again — keep polling until a message arrives.
3. Call `send_chat_action` with action `typing` to signal you are working.
4. Treat the received message as your next task. Complete it.
5. Return to step 1.

Rules:

- Only break the loop when I send exactly: `exit`
- On `exit`, send a goodbye message via Telegram, then stop.
- Never exit for any other reason — including errors, uncertainty, or task completion.
- Never stop polling due to timeouts. If you feel you must stop, first send a Telegram message asking if I want to end the session and wait for my reply before doing so.
- If a task is ambiguous, ask for clarification via Telegram and return to step 2.
