confirm/ok-cancel — Send OK/Cancel confirmation prompt.

Sends message with OK (primary/blue) and Cancel buttons.
Blocks until button pressed, timeout expires, or user replies with text/voice.
Returns confirmed: true/false, timed_out, or skipped.

## Params
token: session token (required)
text: question requiring confirmation (required)
timeout_seconds: wait time in seconds (optional; default 600)
yes_style: OK button color (optional; "success" | "primary" | "danger"; default "primary")
ignore_pending: skip pending-updates check (optional)

## Examples
Standard:
action(type: "confirm/ok-cancel", token: 3165424, text: "Deploy to production?")
→ { confirmed: true, message_id: 42 }

User cancelled:
→ { confirmed: false, message_id: 42 }

Timeout:
→ { timed_out: true, message_id: 42 }

User typed instead of pressing:
→ { skipped: true, text_response: "not now", message_id: 42 }

## Notes
Drain pending first: dequeue(token: ..., max_wait: 0)

Related: confirm/ok, confirm/yn, acknowledge