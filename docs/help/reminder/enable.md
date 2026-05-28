reminder/enable — Re-activate a previously disabled reminder.

Idempotent — calling on an already-active reminder is safe. Does not affect sleep state; a sleeping-but-enabled reminder resumes firing when its sleep expires.

## Params
token: session token (required)
id: reminder ID to enable (required; from reminder/list)

## Example
action(type: "reminder/enable", token: 3165424, id: "abc123")
→ { enabled: true, id: "abc123", state: "active" }

## Error cases
NOT_FOUND → no reminder with that ID; check reminder/list for valid IDs

Related: reminder/disable, reminder/sleep, reminder/list
