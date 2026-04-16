Progress — Percentage-based progress bar tracking.

Routes:
- progress/update — update existing progress bar message

action(type: "progress") — lists sub-paths in live API.

Create initial bar with standalone tool: send_new_progress(title, percent, token)
Then update in-place with progress/update using returned message_id.

## When to use
- Continuous percentage progress (file processing, build steps with %)
- For discrete named steps: use checklist/update instead

Related: checklist/update, message/edit