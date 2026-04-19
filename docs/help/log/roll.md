log/roll — Rotate current log file (governor only).

Closes current log, archives it with timestamp filename, starts new log immediately.
Emits service notification to chat with archived filename.
Log content never transits Telegram.

## Params
token: session token (required; governor only)

## Example
action(type: "log/roll", token: 1000001)
→ { rolled: true, filename: "2025-04-05T143022.json" }

Empty log:
→ { rolled: false, message: "No events in current log — nothing to roll." }

## Use cases
- Archive log before shutdown
- Split logs at shift boundaries
- Prevent log files from growing too large

## Typical archive pattern
1. action(type: "log/roll", token: ...) → get archived filename
2. action(type: "log/get", token: ..., filename: "...") → read content
3. action(type: "log/delete", token: ..., filename: "...") → clean up

Related: log/list, log/get, log/delete, logging/toggle