show-typing — Show sustained typing indicator in chat.

Repeats every 4s until timeout expires or real message sent. Idempotent — safe to call multiple times.
Cancelled automatically when any message is sent.
For persistent in-chat visual placeholder, use animation instead.

## Params
token: session token (required)
timeout_seconds: how long to show indicator (optional; 1–300s; default 20)
cancel: immediately stop typing indicator (optional; replaces old cancel_typing)

## Examples
Start typing (20s default):
action(type: "show-typing", token: 3165424)
→ { ok: true, timeout_seconds: 20, started: true }

Start with custom timeout:
action(type: "show-typing", token: 3165424, timeout_seconds: 60)

Cancel typing:
action(type: "show-typing", token: 3165424, cancel: true)
→ { ok: true, cancelled: true }

## Use cases
- Brief processing indicator (under 60s)
- Before sending a long reply
- While waiting for external API

For longer operations: use show_animation (placeholder persists through sends)

Related: animation/default, animation/cancel