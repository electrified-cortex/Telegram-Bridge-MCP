# [Unreleased]

## v7.0.0 — Unreleased

### Added

- Unrenderable character detection: `send` warns when message content contains Unicode characters that do not render in Telegram (e.g. certain symbol blocks); the warning lists the offending characters and their code points
- Behavioral nudge system: per-session checklist tracks button awareness (`knowsButtons`) and question-without-button count; fires `behavior_nudge_question_hint` on first actionable `?` question sent without buttons, and `behavior_nudge_question_escalation` after 10+ such questions — nudges are suppressed once the agent uses buttons in any form or consults button help
- `onboarding_buttons` service message: delivered during session start (both first-session and subsequent-session paths) covering OK / OK-Cancel / Y-N presets and hybrid message guidance (audio + caption + buttons in one message)
- `MAX_NUDGES_PER_SESSION` raised from 3 to 5 to accommodate the two new question nudge types without crowding other behavioral nudges
- `src/behavior-tracker.ts`: `recordButtonUse(sid)` — marks session as button-aware and suppresses all subsequent question nudges; `recordOutboundText(sid, text)` — evaluates outbound text against actionable-question heuristics and fires hint/escalation nudges as appropriate
- `docs/help/send.md`: Hybrid section documenting audio + caption + buttons composition pattern
- `docs/help/guide.md`: Button presets table covering OK, OK-Cancel, Y-N, and custom choose patterns
- `docs/communication.md`: Quick-presets callout added under Hard Rule 2
- `session/rename` action: added optional `color` parameter — applies a session color change atomically with the rename in the same operator-approval flow
- `session/rename` action: added optional `target_sid` parameter (governor only) — allows the governor to rename another session; returns `PERMISSION_DENIED` for non-governor callers; validates the target session exists before prompting the operator
- `session/close` action: added `force?: boolean` parameter — when `true`, allows closing the last active session without triggering the last-session guard
- `session/close/signal` action (governor only): accepts `target_sid` and optional `timeout_seconds` — delivers a `session_close_signal` service message to the target, waits up to the timeout for self-close, force-closes via `closeSessionById` on expiry; re-checks governor status before force-closing (returns `PERMISSION_DENIED` if governor changed during the wait), detects self-close mid-wait, and rejects callers that are non-governor, target themselves, or name an unknown SID
- `src/silence-detector.ts`: two-rung silence nudge system — fires a presence reminder after 30 s of agent inactivity when operator content is pending (rung-1) and a stronger nudge after 60 s (rung-2); outbound signals (send, typing, animation, reaction, confirm) reset the clock per episode; each new inbound message grants a 30 s grace window before rung-1 can fire
- `src/behavior-tracker.ts`: `recordPresenceSignal(sid)` — resets the per-session silence clock on any outbound action; now also called in the `confirm/` action branch (alongside `btRecordButtonUse`) so confirm interactions count as agent presence
- Transcription log events: voice note processing now emits `event: "transcription"` (`type: "voice_transcription"`, includes transcribed text) on success and `event: "transcription_error"` (`type: "voice_transcription_error"`, includes `error_code` and `error`) on failure — surfacing transcription outcomes in the session event log

### Changed

- Unknown-parameter warning middleware: `registerTool` wrapper now strips unrecognised parameters before passing args to the handler and injects a `warning` field into the response payload listing the dropped keys — tools always execute with the valid subset, the call is never rejected (PR #147)
- `shutdown` MCP tool: now bypasses the pending-message guard and exits immediately when no sessions are active (pending items cannot be processed without a session to route to); the guard still applies when one or more sessions exist
- Button callback `timeout_seconds` now has no default — omitting it holds buttons open for up to 24 hours (server-side ceiling). Explicit values are still honored. Max raised from 300 s to 86400 s (24 h).
- Service message content rewrite: all `SERVICE_MESSAGES` constant values rewritten to ultra-compressed spec — minimum words, help() breadcrumbs, no pin/formula references; consolidated 6 governor-change variants to single `GOVERNOR_CHANGED`; added `SESSION_JOINED`
- `ask` timeout default: omitting `timeout_seconds` now uses the caller session's dequeue default (300 s if unset) instead of 24 h — agents that relied on the implicit 24 h hold must set an explicit `timeout_seconds` or raise their dequeue default via `action(type: 'profile/dequeue-default')`

### Fixed

- `send_new_checklist`/`update_checklist`: completion reply now reflects actual outcome — `✅ Complete`, `🟡 Incomplete N/M done`, or `🔴 Failed — N/M passed, F failed` with step counts; was always `✅ Complete` regardless of failed/skipped steps (task 20-471)

- `set_reaction` with a `reactions` array: permanent base layer no longer makes its own redundant API call when a temporary overlay is active — the base is registered virtually and applied only when the last temporary reaction expires (`_fireRestoreForSlot` / `clearAllTempReactions`). `getBotReaction(messageId)` is now updated after each restore or clear so the bot reaction index remains accurate.

- Recording indicator no longer drops prematurely between TTS synthesis/upload and message render: `gen` is now updated after each `showTyping()` call so `cancelTypingIfSameGeneration` targets the correct generation; voice file sends via `send_file` now include a 3 s post-send delay and explicit `cancelTypingIfSameGeneration` in a `finally` block (task 10-recording-indicator-gap)
- `session/close`: rejects with `LAST_SESSION` error code (and actionable hint) when called on the last active session without `force: true`; prevents accidental orphaning of the bridge process
- Fixed governor SID being cleared when governor closes a non-governor session in a 2-session setup (10-493). Governor role is now correctly preserved when a non-governor session closes.
- `/shutdown` built-in command: with zero active sessions, shutdown now skips poller wait/drain and the extra stdio delay so it exits immediately instead of waiting through timeout windows
- Shutdown log handling: local log buffers are flushed before exit, and when session-log mode is disabled the active local log is rolled on shutdown if one exists
- `/shutdown` built-in command handling now schedules shutdown on the next tick so poller-driven command handling cannot self-block the graceful shutdown wait path
- Built-in command stale filtering now includes a 30-second clock-skew grace window so fresh slash commands are not incorrectly ignored as stale
- `dequeue` wait loop: fixed a lost-wakeup race where an event enqueued between the empty-check and waiter registration could leave the agent blocked until another message arrived
- `AUTH_FAILED` guidance now explicitly mentions closed/restarted sessions so mid-session token failures direct agents to `action(type: 'session/reconnect', ...)`
- Graceful shutdown now has a hard-exit watchdog and duplicate-request guard so `/shutdown` cannot hang indefinitely on stalled network cleanup calls
- Background Telegram poller now starts unconditionally at server startup so built-in commands (`/shutdown`, `/session`, etc.) work even when no agent session is active
- `src/local-log.ts`: Fixed concurrent flush race — serialized `_actualFlush` calls via promise chaining to prevent dropped or interleaved log entries when `flushCurrentLog()` is called concurrently (PR #148)

## v6.0.2 — 2026-04-11

### Fixed

- Replaced legacy tool name references (`session_start`, `list_sessions`, `save_profile`, `list_reminders`) in all user-facing error/recovery strings with v6 `action()` dispatcher paths

- `src/tools/help.ts`: `startup` topic — token line now says "Required for all session-bound calls" (was "Required for all calls"); `message/history` example now includes `count: 20`
- `src/tools/help.test.ts`: Added test coverage for `startup` topic
- `src/tools/session_start.test.ts`: Section comment updated from "instructions field" to "hint field"
- `src/reauth-dismiss.test.ts`: Added `afterEach` hook reset to prevent cross-test auth hook leak
- `.github/workflows/ci.yml`: Downgraded `pnpm/action-setup` v6→v4; added `version: "10.0.0"` to pin pnpm exactly (v6 failed with `ERR_PNPM_BROKEN_LOCKFILE` on valid lockfiles)

## v6.0.1 — 2026-04-10

### Added

- Reauth dialog auto-dismiss: when a session has a pending reconnect approval dialog and a subsequent tool call succeeds with a valid token, the dialog is automatically deleted (task 30-475)

### Fixed

- `src/reauth-dismiss.test.ts`: Corrected `vi.fn<>` generic syntax to use single function-type argument matching Vitest 2.x API (task 40-478)

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
- ESLint now ignores `src/tools/_retired/**` so retired tools no longer block active code lint validation

## Fixed

- `send(type: "progress"/"checklist")` — `text` param now accepted as an alias for `title` (caption above bar/checklist); `title` takes precedence when both are provided. Previously `text` was silently ignored, rendering no caption.
- `send_new_progress` / `update_progress` — progress bar state (title, subtext, width) now persisted in `src/progress-store.ts`; `update_progress` uses stored values as defaults when caller omits them; explicit overrides update the store; empty string clears stored field; 100% completion deletes the store entry. Previously, calling `update_progress` with only `percent` erased the title and subtext.
- `/voice`, `/version`, `/session` built-in command responses no longer prepend the active session's name tag; `_skipHeader: true` added to `sendMessage` calls in those handlers. `/logging` was already correct.
- Session approval menu (`/approve`) UX: delegate toggle now edits panel in-place instead of creating new messages; toggle buttons relabeled as actions (`Enable/Disable Delegation`); all buttons given consistent emoji treatment; collapsed messages use `→ [action]` format; 10-minute mode collapse includes expiry HH:MM.
- Non-blocking `send_choice` button press now collapses the message to show `▸ *[selected label]*` with buttons removed, matching blocking `choose` behavior. Previously buttons disappeared with no feedback.
- `/session` detail panel: `Started` field now shows `HH:MM` local time instead of raw ISO string; "Set as Primary" button hidden when the selected session is already the primary (governor).
- `/log` command now aliases `/logging`; removed from bot command list. `/logging` panel "Dump" renamed to "💾 Save log", "Flush (N)" renamed to "🗑 Clear (N)"; ON-state buttons split into 2×2 layout for mobile.
- Service message visual consistency: `/logging` panel buttons all have emoji (`✓ Enable`, `✗ Disable`); flush confirm buttons get emoji; `/session` list panel gets `_skipHeader: true` and a `🖥` title emoji.
- `renderProgress()` subtext no longer force-wrapped in `<i>...</i>`; renders as plain escaped text so senders control their own formatting.
- `load_profile` / `action(type: "profile/load")`: `color_hint` field in profile now applied retroactively via `setSessionColor`; corrects mis-assigned session color after start. Only applies when the hinted color is not already held by another session. `profiles/Worker.json`, `Curator.json`, `Overseer.json` updated with `color_hint`.
- `send(type: "animation", timeout: N)` — `timeout` param was silently dropped because the schema used `animation_timeout`; animation ran for the default 600 s instead of the specified value. Renamed schema param to `timeout`.
- `action(type: "animation/default", preset: "working")` / `set_default_animation(preset: "working")` — preset param was accepted without error but fell through to read-only mode; session default was never updated. Now looks up the preset's frames and sets them as the default.
- `action(type: "log/debug", category: "animation")` — `category` schema was `z.enum(...)`, rejecting valid category strings with an unhelpful error. Changed to `z.string()` with valid values listed in the description; unknown categories produce empty results.
- `action(type: "message/edit")` without `parse_mode` — schema field was `optional()` with no default, sending messages as plain text instead of running Markdown auto-conversion. Changed to `.default("Markdown")` to match standalone `edit_message` behavior. `parse_mode` description updated to clarify that `"MarkdownV2"` is raw pass-through (manual escaping required).
- `tasks/claim.ps1` / `tasks/claim.sh` — Replaced with canonical cortex.lan versions using `git mv` for atomic claim (no `GIT_INDEX_FILE` manipulation required; index atomicity provided by `git mv`); `TaskFile` parameter is now optional (scans queue by priority if omitted); rollback via reverse `git mv` on commit failure; added `tasks/claim.spec.md` design specification
- `session_start.ts` orientation messages — removed stale `get_agent_guide` references; replaced with `help(topic: 'guide')` (tool was removed in this release)

## Removed

- `send_text` — replaced by `send`
- `send_message` — replaced by `send`
- `send_text_as_voice` — replaced by `send`
- `get_agent_guide` — removed; replace with `help` tool and `agent-guide` MCP resource
- Removed orphaned `tutorial/on` and `tutorial/off` action handlers and backing session state (`tutorialEnabled`, `tutorialSeenTools`, `isTutorialEnabled`, `setTutorialEnabled`, `markTutorialToolSeen`). The tutorial hint read path was removed by task 10-579; this cleans up the write-only remnants.

## Security

- `logBlockedToolCall` sanitizes `toolName` and `reason` fields by replacing ASCII control characters (U+0000–U+001F, U+007F) with spaces before writing to stderr, preventing log-injection attacks
- `buildDenyPatternHook` now escapes all regex metacharacters in glob patterns (including `?`, `-`, `#`, whitespace) before compiling, preventing pattern bypass via metacharacter injection
- `tasks/claim.ps1` / `tasks/claim.sh` — `GIT_INDEX_FILE` no longer referenced; atomic `git mv` eliminates shared-index exposure during claim; `docs/git-index-safety.md` updated to clarify the pattern applies to scripts using `git add`/`git rm --cached` directly, not `git mv`-based scripts

### Documentation

- Added `docs/migration-v5-to-v6.md` — complete v5→v6 tool mapping, before/after examples, breaking changes
- Updated `README.md` to reflect 4-tool v6 architecture
- Updated `docs/setup.md` to remove v5 tool name references
- Updated `docs/help/guide.md` (renamed from `docs/behavior.md`) and `LOOP-PROMPT.md` for v6 tool names
- Added `docs/git-index-safety.md` — GIT_INDEX_FILE contamination hazard, fix pattern (PowerShell and bash), and historical incident reference (task 10-429)

## Deprecated

- All v5 standalone tools (e.g. `send_text`, `ask`, `choose`, `notify`, `edit_message`, `session_start`, etc.) — fully retired; functionality available via `send`, `dequeue`, `help`, and `action`
