animation/cancel — Stop active animation.

Without text: deletes placeholder message.
With text: edits placeholder into permanent logged message.
No-op if no animation is active.

## Params
token: session token (required)
text: replacement text (optional; turns placeholder into real message)
parse_mode: "Markdown" (default) | "HTML" | "MarkdownV2"

## Examples
Cancel and delete placeholder:
action(type: "animation/cancel", token: 3165424)
→ { cancelled: true, message_id: null }

Cancel and replace with result:
action(type: "animation/cancel", token: 3165424, text: "Task complete: 3 files updated")
→ { cancelled: true, message_id: 42 }

No active animation:
→ { cancelled: false }

Full guide: help(topic: 'animation')

Related: animation/default, show-typing