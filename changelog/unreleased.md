# [Unreleased]

## Added

- `src/tool-hooks.ts`: `buildDenyPatternHook(patterns)` — builds a pre-tool hook that blocks tool calls matching any of the provided glob patterns
- `src/tool-hooks.ts`: `invokePreToolHook(hook, toolName, input)` — invokes a pre-tool hook; blocked calls are logged and return a deny result
- `src/tool-hooks.ts`: `logBlockedToolCall(toolName, reason)` — writes a `[hook:blocked]` line to stderr when a tool call is denied
- `src/local-log.ts`: `logEvent(event)` — appends a structured JSON event record to the active session log file on disk using `appendFileSync`
- `src/local-log.ts`: `rollLog()` — archives the current session log and opens a new one
- `src/local-log.ts`: `isLoggingEnabled()` — returns whether disk logging is active
- `get_log` MCP tool — reads a local log file by filename; returns file content via MCP tool response (log content never transits Telegram); list mode (omit filename) returns `{ current_log, log_files, count }`
- `list_logs` MCP tool — lists available local log files
- `roll_log` MCP tool — archives the current session log and starts a new one

## Changed

- Shutdown sequence now calls `rollLog()` to archive the active session log instead of the no-op `flushCurrentLog()`
- `get_log` list mode response now includes `current_log` field identifying the active session log filename

## Fixed

## Removed

## Security

- `logBlockedToolCall` sanitizes `toolName` and `reason` fields by replacing ASCII control characters (U+0000–U+001F, U+007F) with spaces before writing to stderr, preventing log-injection attacks
- `buildDenyPatternHook` now escapes all regex metacharacters in glob patterns (including `?`, `-`, `#`, whitespace) before compiling, preventing pattern bypass via metacharacter injection

## Deprecated

