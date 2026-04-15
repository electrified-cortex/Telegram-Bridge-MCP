shutdown/warn — Send pre-shutdown advisory DM to all other sessions.

DMs every other active session with shutdown warning and cleanup instructions.
Does NOT shut down server — call action(type: "shutdown") separately when ready.
Governor-only route.

## Params
token: session token (required; must be governor)
reason: human-readable shutdown reason (optional; e.g. "code update")
wait_seconds: estimated seconds before shutdown fires (optional)

## Example
action(type: "shutdown/warn", token: 1000001, reason: "code update", wait_seconds: 60)
→ { notified: 3 }

## Typical sequence
1. action(type: "shutdown/warn", token: ..., reason: "...", wait_seconds: 60)
2. Wait for workers to DM back "shutting down"
3. action(type: "shutdown", token: ...)

## Worker response to warn
1. Finish current step
2. Delete stored session token
3. action(type: "session/close", token: ...)
4. Stop — no more tool calls

Full procedure: help(topic: 'shutdown')

Related: shutdown, session/close, session/list