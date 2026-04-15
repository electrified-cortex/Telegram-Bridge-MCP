progress/update — Update progress bar message in-place.

Edits existing progress bar with new percentage. Auto-unpins and sends "✅ Complete" when percent reaches 100.
Use send_new_progress (standalone tool) to create initial bar and get message_id.

## Params
token: session token (required)
message_id: ID of progress bar message (required; from send_new_progress)
percent: progress percentage (required; 0–100)
title: bold heading (optional; omit or "" for bar-only layout)
subtext: italicized detail line below bar (optional; "" to clear)
width: bar width in characters (optional; 1–40; default 10)

## Examples
Update percentage:
action(type: "progress/update", token: 3165424, message_id: 42, percent: 45)
→ { message_id: 42, updated: true }

With context:
action(type: "progress/update", token: 3165424,
  message_id: 42,
  percent: 72,
  title: "Processing files",
  subtext: "43/60 files done")

Complete (auto-unpins):
action(type: "progress/update", token: 3165424, message_id: 42, percent: 100)
→ { message_id: 42, updated: true }  (+ "✅ Complete" reply sent)

## Pattern
1. send_new_progress(title: "...", percent: 0, token: ...) → { message_id: 42 }
2. action(type: "progress/update", ..., message_id: 42, percent: N)
3. Repeat until percent = 100

Related: checklist/update, message/edit, message/pin