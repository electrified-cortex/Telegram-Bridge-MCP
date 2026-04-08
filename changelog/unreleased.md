# [Unreleased]

## Added

- `send` MCP tool — unified text/voice messaging tool replacing `send_text`, `send_message`, and `send_text_as_voice`; selects voice or text mode via `voice` parameter
- `approve_agent` MCP tool — governor-only session approval; always registered but returns a `BLOCKED` error at runtime unless agent delegation is enabled
- `toggle_logging` MCP tool — enables or disables disk logging for the current session
- `delete_log` MCP tool — deletes a specific local log file by filename
- Dynamic agent approval with color assignment — sessions approved via `/approve` command or operator dialog are assigned a color from the available palette
- Animation auto-cancel — starting a new animation or sending a message automatically cancels any active animation for the session
- `help` MCP tool — API discovery tool listing all registered tools with descriptions; replaces `get_agent_guide`
- `src/tool-hooks.ts`: `buildDenyPatternHook(patterns)` — builds a pre-tool hook that blocks tool calls matching any of the provided glob patterns
- `src/tool-hooks.ts`: `invokePreToolHook(toolName, args)` — invokes a pre-tool hook; blocked calls are logged and return a deny result
- `src/server.ts`: `logBlockedToolCall(toolName, reason)` — writes a `[hook:blocked]` line to stderr when a tool call is denied
- `src/local-log.ts`: `logEvent(event)` — appends a structured JSON event record to the active session log file on disk using `appendFileSync`
- `src/local-log.ts`: `rollLog()` — archives the current session log and opens a new one
- `src/local-log.ts`: `isLoggingEnabled()` — returns whether disk logging is active
- `get_log` MCP tool — reads a local log file by filename; returns file content via MCP tool response (log content never transits Telegram); list mode (omit filename) returns `{ current_log, log_files, count }`
- `list_logs` MCP tool — lists available local log files
- `roll_log` MCP tool — archives the current session log and starts a new one

## Changed

- `send`, `confirm`, `confirmYN`, `choose` — `voice` parameter renamed to `audio` (spoken TTS content); `voice` and `speed` are now separate top-level parameters for TTS voice/speed overrides; inner `voice` field is removed from the `send` audio union (replaced by flat `voice` param)
- `dequeue_update` now returns `session_closed` events when the active session is terminated during a wait
- Cold-start governor workflow fixed — first-session approval no longer requires a pre-existing session context
- Tool descriptions tightened across all registered tools to minimize per-call context usage
- Shutdown sequence now calls `rollLog()` to archive the active session log instead of the no-op `flushCurrentLog()`
- `get_log` list mode response now includes `current_log` field identifying the active session log filename

## Fixed

## Removed

- `send_text` — replaced by `send`
- `send_message` — replaced by `send`
- `send_text_as_voice` — replaced by `send`
- `get_agent_guide` — replaced by `help`

## Security

- `logBlockedToolCall` sanitizes `toolName` and `reason` fields by replacing ASCII control characters (U+0000–U+001F, U+007F) with spaces before writing to stderr, preventing log-injection attacks
- `buildDenyPatternHook` now escapes all regex metacharacters in glob patterns (including `?`, `-`, `#`, whitespace) before compiling, preventing pattern bypass via metacharacter injection

## Deprecated

