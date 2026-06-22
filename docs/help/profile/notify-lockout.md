profile/notify-gate — Get or set the post-notify lockout window for this session.

After the activity file is touched or the SSE stream is notified, the bridge suppresses further notifications for the lockout window to avoid rapid-fire re-notifications. Adjust if your session processes events faster or slower than the default.

Default: 300,000 ms (5 min). Range: 1,000–3,600,000 ms (1 s–1 hr).

## Params

token: session token (required)
ms: lockout window in milliseconds (optional; omit to read current value)

## Example — read current

action(type: "profile/notify-gate", token: 3165424)
→ { ok: true, ms: 300000, default_ms: 300000 }

## Example — set

action(type: "profile/notify-gate", token: 3165424, ms: 60000)
→ { ok: true, ms: 60000, previous: 300000 }

## Error cases

Invalid ms range → error: ms must be between 1000 and 3600000

## Deprecated aliases

profile/kick-gate is a deprecated alias for profile/notify-gate. Use profile/notify-gate for all new code.

profile/kick-lockout is a deprecated alias for profile/notify-debounce (the debounce window). See help('profile/notify-debounce').

Related: activity/file/touch, profile/save, profile/load
