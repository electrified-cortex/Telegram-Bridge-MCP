reminder/list — List all scheduled reminders for current session.

Returns deferred, active, and startup reminders. Includes fires_in_seconds for deferred reminders.

## Params
token: session token (required)

## Example
action(type: "reminder/list", token: 3165424)
→ { reminders: [
  { id: "abc123", text: "Check Worker", trigger: "time", state: "deferred", delay_seconds: 600, recurring: false, fires_in_seconds: 450 },
  { id: "xyz789", text: "Load profile", trigger: "startup", state: "startup", recurring: true }
]}

## States
- deferred: waiting for delay to elapse
- active: in queue, fires on next 60s idle window
- startup: fires on next session/start or reconnect

## Use cases
- Verify reminders loaded correctly after profile/load
- Find reminder IDs for cancellation
- Audit outstanding follow-ups

Related: reminder/set, reminder/cancel, profile/save