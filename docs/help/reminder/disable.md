reminder/disable — Pause a reminder without deleting it.

The reminder keeps its full config (text, interval, recurring) but stops firing until re-enabled. Idempotent. Disabled state persists across session restart and profile/save.

## Params
token: session token (required)
id: reminder ID to disable (required; from reminder/list)

## Example
action(type: "reminder/disable", token: 3165424, id: "abc123")
→ { disabled: true, id: "abc123" }

## Error cases
NOT_FOUND → no reminder with that ID; check reminder/list for valid IDs

Related: reminder/enable, reminder/sleep, reminder/list, reminder/cancel
