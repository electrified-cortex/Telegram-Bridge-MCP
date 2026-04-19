commands/set — Register slash commands shown in Telegram "/" menu.

Pass array of {command, description} pairs. Pass empty array to clear command menu.
Built-in commands always prepended (survive agent updates).
Scoped to active chat by default ("chat" scope).

## Params
token: session token (required)
commands: command list (required; pass [] to clear)
  Each item: { command: string, description: string }
  command: lowercase letters, digits, underscores only (no leading slash)
  description: 1–256 chars
scope: "chat" (default) | "default"
  chat: visible only in current chat
  default: bot-wide for all private chats

## Examples
Register commands:
action(type: "commands/set", token: 3165424, commands: [
  { command: "status", description: "Show current task status" },
  { command: "cancel", description: "Cancel current task" }
])
→ { ok: true, count: 4, scope: "chat", commands: [...] }

Clear custom commands (keeps built-ins):
action(type: "commands/set", token: 3165424, commands: [])
→ { ok: true, cleared: true, count: 2 }

Related: session/start, approve