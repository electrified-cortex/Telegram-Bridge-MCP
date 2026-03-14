# Telegram Loop Prompt

Start a persistent Telegram chat loop using the Telegram Bridge MCP tools.

## Setup

1. Call `get_agent_guide`
2. Read `telegram-bridge-mcp://communication-guide`
3. Call `get_me` — if it fails, tell the user in VS Code and stop
4. `session_start` — intro + handles pending messages from previous session
5. `dequeue_update` — enter the loop

## Loop

→ receive
→ react (if appropriate)
→ `show_animation` (contextual:thinking)
→ think
→ `show_animation` (contextual:working)
→ work
→ `show_typing` (will cancel animation unless set to persistent)
→ reply/interact
→ `dequeue_update`
