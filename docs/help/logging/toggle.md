logging/toggle — Enable or disable local session logging.

When disabled, no new events written to log file. Events queued for async write.
To archive current log before disabling, call log/roll first.

Note: naming inconsistency — this should be log/toggle in future refactor.

## Params
token: session token (required)
enabled: true to enable logging, false to disable (required)

## Examples
Enable logging:
action(type: "logging/toggle", token: 3165424, enabled: true)
→ { logging_enabled: true }

Disable logging:
action(type: "logging/toggle", token: 3165424, enabled: false)
→ { logging_enabled: false }

## Pattern: archive then disable
1. action(type: "log/roll", token: ...) → archive current log
2. action(type: "logging/toggle", token: ..., enabled: false)

Related: log/roll, log/list, log/get, log/debug