confirm/ok — Send single-button OK confirmation prompt.

Sends message with OK button (primary/blue). No cancel option.
Blocks until button pressed or timeout expires.
Simplified preset of confirm/ok-cancel with no_text="".

## Params
token: session token (required)
text: question or statement requiring acknowledgment (required)
timeout_seconds: wait time in seconds (optional; default 600)
yes_text: OK button label (optional; default "OK")
yes_style: button color (optional; "success" | "primary" | "danger"; default "primary")
reply_to: reply to this message ID (optional)
ignore_pending: skip pending-updates check (optional)
audio: spoken TTS text for voice note variant (optional)

## Example
action(type: "confirm/ok", token: 3165424, text: "Task complete. Acknowledged?")
→ { confirmed: true, message_id: 42 }

Timeout:
→ { timed_out: true, message_id: 42 }

## Notes
Single-button CTA mode: user taps OK or sends text/voice (skipped result).
Drain pending before calling: dequeue(token: ..., timeout: 0)

Related: confirm/ok-cancel, confirm/yn, acknowledge