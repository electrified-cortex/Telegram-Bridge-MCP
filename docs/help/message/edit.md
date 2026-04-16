message/edit — Edit existing message text, keyboard, or both.

Pass text to update content. Pass keyboard to update/remove buttons. Pass both to update both.
Pass keyboard: null to remove all buttons while leaving text unchanged.
Omit text for keyboard-only update. Omit keyboard to leave keyboard unchanged.

## Params
token: session token (required)
message_id: ID of message to edit (required)
text: new text content (optional)
keyboard: inline keyboard rows (optional; null = remove buttons; array of rows)
  Row format: [[{ label, value, style? }]]
  style: "success" | "primary" | "danger"
parse_mode: "Markdown" (default) | "HTML" | "MarkdownV2"

## Examples
Edit text only:
action(type: "message/edit", token: 3165424, message_id: 42, text: "Updated content")
→ { message_id: 42 }

Remove buttons:
action(type: "message/edit", token: 3165424, message_id: 42, keyboard: null)

Update keyboard:
action(type: "message/edit", token: 3165424, message_id: 42, keyboard: [[
  { label: "Done", value: "done_cb", style: "success" }
]])

Related: message/get, message/delete