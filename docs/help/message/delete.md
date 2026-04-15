message/delete — Delete a message.

Bot can delete own messages anytime. Other users' messages deletable only within 48h if bot is admin.

## Params
token: session token (required)
message_id: ID of message to delete (required)

## Example
action(type: "message/delete", token: 3165424, message_id: 42)
→ { ok: true }

## Use cases
- Remove approval prompt after decision made
- Clean up animation placeholders
- Delete stale pinned messages

Related: message/edit, message/pin, message/get