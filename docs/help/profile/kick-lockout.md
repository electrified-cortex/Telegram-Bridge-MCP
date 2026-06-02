profile/kick-lockout — Get or set the post-kick lockout window for this session.

After the activity file is kicked, the bridge suppresses further kicks for the lockout window to avoid rapid-fire re-kicks. Adjust if your session processes events faster or slower than the default.

Default: 300,000 ms (5 min). Range: 1,000–3,600,000 ms (1 s–1 hr).

## Params

token: session token (required)
ms: lockout window in milliseconds (optional; omit to read current value)

## Example — read current

action(type: "profile/kick-lockout", token: 3165424)
→ { ok: true, ms: 300000, default_ms: 300000 }

## Example — set

action(type: "profile/kick-lockout", token: 3165424, ms: 60000)
→ { ok: true, ms: 60000, previous: 300000 }

## Error cases

Invalid ms range → error: ms must be between 1000 and 3600000

## Deprecated alias: profile/kick-debounce

profile/kick-debounce is a deprecated alias. It translates its ms value directly to the kick-lockout window and emits a service message warning. Use profile/kick-lockout for all new code.

Related: activity/file/touch, profile/save, profile/load
