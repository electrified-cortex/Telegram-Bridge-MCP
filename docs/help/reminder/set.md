reminder/set — Schedule reminder that fires as synthetic event.

Two trigger modes: "time" (fires after idle period) or "startup" (fires on next session/start).
Immediate vs deferred: delay_seconds=0 → active immediately; >0 → waits then activates.
Max 20 reminders per session.

## Params
token: session token (required)
text: reminder message text (required; max 500 chars)
trigger: "time" (default) | "startup"
  time: fires after delay_seconds + 60s idle window
  startup: fires automatically on session/start or reconnect
delay_seconds: seconds before reminder becomes active (optional; default 0; max 86400; ignored for startup)
recurring: re-arm after firing (optional; default false)
id: custom ID for cancellation (optional; auto-generated content hash if omitted — deterministic dedup)

## Examples
Time reminder (10 min):
action(type: "reminder/set", token: 3165424, text: "Check Worker 2 status", delay_seconds: 600)
→ { id: "abc123", state: "deferred", fires_in_seconds: 600 }

Startup reminder (fires on every reconnect):
action(type: "reminder/set", token: 3165424, text: "Load profile", trigger: "startup", recurring: true)
→ { id: "xyz789", state: "startup", recurring: true }

Recurring delegation reminder:
action(type: "reminder/set", token: 3165424, text: "Verify Deputy task", delay_seconds: 1800, recurring: true)

Full guide: help(topic: 'reminders')

Related: reminder/cancel, reminder/list, profile/save