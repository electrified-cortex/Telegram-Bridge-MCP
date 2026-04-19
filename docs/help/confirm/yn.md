confirm/yn — Send Yes/No confirmation prompt.

Sends message with 🟢 Yes and 🔴 No buttons (no color styling by default).
Same behavior as confirm/ok-cancel but with Yes/No framing.

## Params
token: session token (required)
text: yes/no question (required)
timeout_seconds: wait time in seconds (optional; default 600)
yes_style: Yes button color (optional; "success" | "primary" | "danger")
ignore_pending: skip pending-updates check (optional)

## Examples
Standard:
action(type: "confirm/yn", token: 3165424, text: "Is the build passing?")
→ { confirmed: true, message_id: 42 }

No:
→ { confirmed: false, message_id: 42 }

Timeout:
→ { timed_out: true, message_id: 42 }

## Notes
Drain pending first: dequeue(token: ..., max_wait: 0)
Emoji parity: both buttons have emoji by default — consistent styling enforced.

Related: confirm/ok, confirm/ok-cancel, acknowledge