reminder/cancel — Cancel scheduled reminder by ID.

Returns error if ID not found. Use reminder/list to see active reminder IDs.

## Params
token: session token (required)
id: reminder ID to cancel (required; from reminder/set or reminder/list)

## Example
action(type: "reminder/cancel", token: 3165424, id: "abc123")
→ { cancelled: true, id: "abc123" }

## Error cases
NOT_FOUND → no reminder with that ID; check reminder/list for valid IDs

## Pattern
1. action(type: "reminder/list", token: ...) → find ID
2. action(type: "reminder/cancel", token: ..., id: "...")

Related: reminder/set, reminder/list