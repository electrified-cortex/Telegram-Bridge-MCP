Commands — Telegram slash command menu management.

Routes:
- commands/set — register or clear slash commands

action(type: "commands") — lists sub-paths in live API.

Built-in commands (/help, /approve, etc.) always present regardless of agent commands.
Scope: "chat" recommended — keeps commands isolated to active conversation.

Related: session/start, approve