acknowledge — Acknowledge a callback query from inline button press.

Only needed when handling button presses manually. choose, confirm, and send_choice auto-ack automatically.
Must be called within 30s of receiving the update. Optionally shows toast or alert.

## Params
token: session token (required)
callback_query_id: ID from callback_query update (required)
text: toast notification text shown to user (optional; up to 200 chars)
show_alert: show as dialog alert instead of toast (optional)
url: URL to open in user's browser (optional; for games)
cache_time: seconds result may be cached client-side (optional)

## Example
action(type: "acknowledge", token: 3165424, callback_query_id: "CQR12345")
→ { ok: true }

With toast:
action(type: "acknowledge", token: 3165424, callback_query_id: "CQR12345", text: "Received!", show_alert: false)

## When to use
- Custom non-blocking keyboards via message/edit + callback hook
- Manual button press handling outside confirm/choose flows

Related: react, confirm/ok, confirm/yn, message/edit
