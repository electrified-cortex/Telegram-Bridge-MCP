chat/info — Get chat metadata with operator approval.

Sends interactive Allow/Deny prompt and blocks until operator responds or request times out.
Returns chat id, type, title, username, first/last name, description on approval.

## Params
token: session token (required)

## Example
action(type: "chat/info", token: 3165424)

On approval:
→ { approved: true, id: -100123456, type: "group", title: "cortex.lan", username: null, ... }

On denial:
→ { approved: false, timed_out: false, message_id: 42 }

Timeout (60s):
→ { approved: false, timed_out: true, message_id: 42 }

## Notes
- Operator confirmation required — blocks up to 60s
- Use sparingly; prompts operator for every call
- Primarily for first-run setup or diagnostics

Related: session/list, session/start