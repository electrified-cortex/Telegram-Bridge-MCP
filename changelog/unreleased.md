# [Unreleased]

## Breaking

- **v6 API surface finalized** — All v5 standalone tool registrations removed. Only `send`, `dequeue`, `help`, and `action` are now registered as MCP tools. All previous capabilities remain accessible through these 4 tools.

## Added

- `send` MCP tool — unified text/voice messaging tool replacing `send_text`, `send_message`, and `send_text_as_voice`; selects voice or text mode via `audio` parameter
- Error guidance hints — all error responses include a `hint` field with actionable next steps; unknown `type` and `action` values trigger fuzzy (Levenshtein) matching that suggests the closest valid value; `dequeue` timeout validation messages are human-readable
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

- `send`, `confirm`, `confirmYN`, `choose` — API simplified to `text` (display) + `audio` (spoken TTS content) channels; per-message `voice` and `speed` override params removed from all tools; voice resolution uses session/global settings only; `choose` renames `question` parameter to `text`
- `dequeue_update` renamed to `dequeue`; `dequeue_update` is no longer a registered tool name
- `dequeue` (formerly `dequeue_update`) returns `{ error: "session_closed" }` when the active session is terminated during a wait
- Cold-start governor workflow fixed — first-session approval no longer requires a pre-existing session context
- Tool descriptions tightened across all registered tools to minimize per-call context usage
- Shutdown sequence now calls `rollLog()` to archive the active session log instead of the no-op `flushCurrentLog()`
- `get_log` list mode response now includes `current_log` field identifying the active session log filename
- `action(type: "chat/info")` — new action path returning chat metadata (id, type, title, username, first/last name, description) with a user confirmation prompt; previously accessible only via the v5 `get_chat` standalone tool
- `action(type: "confirm/ok")` / `action(type: "confirm/ok-cancel")` / `action(type: "confirm/yn")` — preset confirm dialogs; caller passes only `text` and `token`; preset button labels eliminate boilerplate
- `send(type: "question", options: [...])` — `options` accepted as alias for `choose` in question choose mode, aligning naming with `send(type: "choice", options: [...])`
- `profile/import` `recurring` field on reminders now defaults to `false` (was required)
- `help(topic: "checklist")` — documents valid step statuses: pending, running, done, failed, skipped
- `help(topic: "animation")` — frame guide including single-emoji sticker workaround (`\u200b` fix)

## Fixed

- `send(type: "animation", timeout: N)` — `timeout` param was silently dropped because the schema used `animation_timeout`; animation ran for the default 600 s instead of the specified value. Renamed schema param to `timeout`.
- `action(type: "animation/default", preset: "working")` / `set_default_animation(preset: "working")` — preset param was accepted without error but fell through to read-only mode; session default was never updated. Now looks up the preset's frames and sets them as the default.
- `action(type: "log/debug", category: "animation")` — `category` schema was `z.enum(...)`, rejecting valid category strings with an unhelpful error. Changed to `z.string()` with valid values listed in the description; unknown categories produce empty results.
- `action(type: "message/edit")` without `parse_mode` — schema field was `optional()` with no default, sending messages as plain text instead of running Markdown auto-conversion. Changed to `.default("Markdown")` to match standalone `edit_message` behavior. `parse_mode` description updated to clarify that `"MarkdownV2"` is raw pass-through (manual escaping required).

## Removed

- `send_text` — replaced by `send`
- `send_message` — replaced by `send`
- `send_text_as_voice` — replaced by `send`
- `get_agent_guide` — removed; replace with `help` tool and `agent-guide` MCP resource

## Security

- `logBlockedToolCall` sanitizes `toolName` and `reason` fields by replacing ASCII control characters (U+0000–U+001F, U+007F) with spaces before writing to stderr, preventing log-injection attacks
- `buildDenyPatternHook` now escapes all regex metacharacters in glob patterns (including `?`, `-`, `#`, whitespace) before compiling, preventing pattern bypass via metacharacter injection

### Documentation

- Added `docs/migration-v5-to-v6.md` — complete v5→v6 tool mapping, before/after examples, breaking changes
- Updated `README.md` to reflect 4-tool v6 architecture
- Updated `docs/setup.md` to remove v5 tool name references
- Updated `docs/behavior.md` and `LOOP-PROMPT.md` for v6 tool names

## Deprecated

- All v5 standalone tools (e.g. `send_text`, `ask`, `choose`, `notify`, `edit_message`, `session_start`, etc.) — fully retired; functionality available via `send`, `dequeue`, `help`, and `action`
