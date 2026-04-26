session/start — Create and register new Telegram session.

Returns a session token. Pass token on every subsequent call.
Second+ sessions require operator approval via Telegram color-picker dialog.
Name collision → error: use dequeue with saved token instead.

## Params
name: display name (optional for first session, required for 2nd+; letters, digits, spaces only)
color: preferred color emoji hint for approval dialog (optional)
  Palette: 🟦 Coordinator · 🟩 Builder · 🟨 Reviewer · 🟧 Research · 🟥 Ops · 🟪 Specialist

## Example
action(type: "session/start", name: "Worker 2", color: "🟩")
→ { token: 3165424, sid: 3, suffix: 165424, sessions_active: 2, action: "fresh", pending: 0 }

Save token immediately — two formats accepted:

- Minimal: write raw token integer to `<Name>/telegram/session.token`
- Full: YAML body in `<Name>/telegram/session.md` with `token:`, `sid:`, `name:`, `started:` fields — no PIN field

## After start
1. Load profile: action(type: "profile/load", token: ..., key: "Worker")
2. Verify reminders: action(type: "reminder/list", token: ...)
3. Enter dequeue loop: dequeue(token: ...)

## Error cases
NAME_CONFLICT → session already exists; find saved token and call dequeue directly
SESSION_DENIED → operator denied; do not retry

Related: session/reconnect, session/list, session/close, profile/load