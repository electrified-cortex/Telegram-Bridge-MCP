session/rename — Rename the current session (or another session if governor).

Requires operator approval via Telegram button. Name must be unique (case-insensitive) among active sessions.
Optionally applies a color change in the same action.
Returns old and new names on success; includes `color` field when color was applied.

## Params
token: session token (required)
new_name: new session name (required; letters, digits, spaces only; max practical ~32)
color: session color emoji to apply (optional; must be a valid palette color)
target_sid: SID of the session to rename (optional; governor only — omit to rename your own session)

## Example
action(type: "session/rename", token: 3165424, new_name: "Builder 2")
→ { sid: 3, old_name: "Worker 2", new_name: "Builder 2" }

action(type: "session/rename", token: 3165424, new_name: "Builder 2", color: "🟩")
→ { sid: 3, old_name: "Worker 2", new_name: "Builder 2", color: "🟩" }

action(type: "session/rename", token: 3165424, new_name: "Helper", target_sid: 5)
→ { sid: 5, old_name: "Worker 3", new_name: "Helper" }

## Error cases
NAME_CONFLICT → another session has that name
INVALID_NAME → non-alphanumeric characters used
INVALID_COLOR → color value not in the valid palette
PERMISSION_DENIED → target_sid used by non-governor session
SESSION_NOT_FOUND → target_sid does not correspond to an active session
APPROVAL_DENIED → operator denied
APPROVAL_TIMEOUT → no response within timeout

Related: session/list, session/start
