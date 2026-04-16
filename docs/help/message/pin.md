message/pin — Pin or unpin a message in chat.

Requires bot admin rights. Pass unpin: true to unpin. Omit message_id with unpin: true to unpin most recently pinned.

## Params
token: session token (required)
message_id: message ID to pin/unpin (required for pinning; optional for unpinning)
disable_notification: pin silently without notifying members (optional; default false)
unpin: if true, unpin instead of pin (optional)

## Examples
Pin message:
action(type: "message/pin", token: 3165424, message_id: 42, disable_notification: true)
→ { ok: true }

Unpin specific message:
action(type: "message/pin", token: 3165424, message_id: 42, unpin: true)
→ { ok: true, unpinned: true }

Unpin most recent:
action(type: "message/pin", token: 3165424, unpin: true)
→ { ok: true, unpinned: true }

Related: message/delete, message/edit, checklist/update