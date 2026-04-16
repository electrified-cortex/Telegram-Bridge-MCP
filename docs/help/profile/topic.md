profile/topic — Set message topic prefix for this session.

Prepends "[Topic]" to every outbound message. Useful when multiple MCP instances share one Telegram chat — labels messages by agent.
Pass empty string to clear.

## Params
token: session token (required)
topic: short label (required; max 32 chars; pass "" to clear; e.g. "Refactor Agent")

## Examples
action(type: "profile/topic", token: 3165424, topic: "Refactor Agent")
→ { topic: "Refactor Agent", previous: null, set: true }

Clear topic:
action(type: "profile/topic", token: 3165424, topic: "")
→ { topic: null, previous: "Refactor Agent", cleared: true }

## Notes
- Scoped to server process, not session — affects all messages from this MCP instance
- Best used with one active chat per host instance

Related: profile/save, profile/load