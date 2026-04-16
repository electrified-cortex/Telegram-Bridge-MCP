message/get — Retrieve stored message by ID and optional version.

Returns text/caption, file_id, media metadata, and edit history.
Only for message IDs known to this session (received via dequeue or referenced by user).
Do not probe arbitrary IDs.

## Params
token: session token (required)
message_id: message ID to look up (required)
version: version to retrieve (optional; default -1 = latest)
  -1 = current/latest
   0 = original
  1+ = edit history (bot messages only)

## Example
action(type: "message/get", token: 3165424, message_id: 42)
→ { message_id: 42, text: "...", type: "text", versions: [-1, 0, 1], ... }

Retrieve original version:
action(type: "message/get", token: 3165424, message_id: 42, version: 0)

## Error cases
MESSAGE_NOT_FOUND → evicted from store or never recorded

Related: message/history, message/edit, message/delete