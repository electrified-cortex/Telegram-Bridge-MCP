session/rename — Rename current session.

Requires operator approval via Telegram button. Name must be unique (case-insensitive) among active sessions.
Returns old and new names on success.

## Params
token: session token (required)
new_name: new session name (required; letters, digits, spaces only; max practical ~32)

## Example
action(type: "session/rename", token: 3165424, new_name: "Builder 2")
→ { sid: 3, old_name: "Worker 2", new_name: "Builder 2" }

## Error cases
NAME_CONFLICT → another session has that name
INVALID_NAME → non-alphanumeric characters used
APPROVAL_DENIED → operator denied
APPROVAL_TIMEOUT → no response within timeout

Related: session/list, session/start