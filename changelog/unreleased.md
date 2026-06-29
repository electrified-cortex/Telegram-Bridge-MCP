# [Unreleased]

## v7.22.9

### Fixed

- **`send` table guard (`TABLE_NOT_RENDERED`)**: any `send(type: "text")` call that contains a GFM markdown table but cannot route to the GFM rich path now returns an explicit `TABLE_NOT_RENDERED` error instead of silently delivering an un-rendered table. Affected paths: effect sends, in-flight-audio sends, and multi-chunk sends. The existing GFM rich-path auto-upgrade (single-chunk, no effect, no in-flight audio) is unaffected and continues to render tables natively. Resolves the false-success regression introduced when `TABLE_WARNING` was removed in v7.22.4.

## In-branch

### Fixed (v7.22.8)

- **`profile/audio-remap/set` null guard (BK-1)**: added early `INVALID_INPUT` return when `word` or `replacement` is falsy — prevents `undefined` from being silently stored as key `"undefined"` in `session.audio_remapping` when optional schema fields are omitted
- **`profile/audio-remap` case-insensitive key normalization (BK-3)**: `set` now stores new entries under the lowercased key; a mixed-case word with the same phonetics as an existing lowercase entry updates that entry in place; a mixed-case word with **distinct phonetics** creates a verbatim exception entry alongside the normalized one. `remove` resolves the effective key by verbatim match first, then normalized fallback — so `remove("Foo")` correctly finds and deletes a `"foo"` entry, and `remove("FOO")` targets a verbatim `"FOO"` exception without touching `"foo"`.

### Changed (v7.22.8)

- **Test fixtures in `src/tools/profile/` (W-6)**: replaced all real product names and phonetic spellings (`nginx`, `engine-x`, `sql`, `sequel`, `api`, `ay-pee-eye`, `ssl`, `es-es-el`) with synthetic words (`zorp`, `ZOR-pee`, `flibble`, `FLIB-ul`, `quux`, `kyoox`) in `audio-remap.test.ts`, `apply.test.ts`, and `save.test.ts`; new test cases added for null guard, lowercase normalization, same-phonetics update-in-place, case-sensitive exception entry, and case-insensitive remove fallback

### Changed

- **rename: notify-lockout terminology renamed to notify-debounce throughout** — `notifyLockedUntil`→`notifyDebounceUntil`, `notifyPendingBecauseLocked`→`notifyPendingBecauseDebounce`, `releaseNotifyLockout`→`releaseNotifyDebounce`, `getNotifyLockoutMs`/`setNotifyLockoutMs`→`getNotifyDebounceMs`/`setNotifyDebounceMs`; constants `LOCKOUT_*`→`NOTIFY_DEBOUNCE_*`; `profile/kick-lockout` action path renamed to `profile/notify-debounce` (old path kept as backward-compat alias); `src/tools/profile/kick-lockout.ts` renamed to `notify-debounce.ts`. Pure terminology change — no behavior or numeric value changes.

## v7.5.2

### Added

- **MCP resource subscription for inbox channel**: clients can subscribe to `telegram://inbox/<token>` via `resources/subscribe` to receive `notifications/resources/updated` push notifications when messages arrive, eliminating the need for activity-file polling
- `src/channel.ts`: new channel subscription registry — cooldown model mirrors activity-file kick gate (leading-edge fire, cooldown window, pending flag); `registerChannelSubscriber`, `unregisterChannelSubscriber`, `notifyChannelSubscriber`, `resetChannelCooldown`, `isChannelActive`, `INBOX_URI_RE` exported
- `server.ts`: `resources/subscribe` and `resources/unsubscribe` request handlers wired to the channel registry; `resources.subscribe: true` capability advertised
- `dequeue.ts`: hint suppression when channel subscription is active (`ONBOARDING_ACTIVITY_FILE_HINT` skipped); `resetChannelCooldown` called on both content-returning exit paths (early-return batch and `finally` block)
- `session-queue.ts`: `notifyChannelSubscriber` called after all enqueue paths (`enqueueToSession`, broadcast, `deliverDirectMessage`, `deliverServiceMessage`, `deliverReminderEvent`, `routeMessage`)
- `session-teardown.ts`: `unregisterChannelSubscriber(sid)` called on session close
- Onboarding messages and docs updated to prefer channel subscription over activity-file polling

### Changed

- `tools/monitor.sh`: rewritten to use OS-native file-event APIs — detects `inotifywait` (Linux, inotify-tools) first, then `fswatch` (macOS, Homebrew), falling back to the original 1-second sleep-loop on any platform that lacks both; output contract (`kick` / `heartbeat` / `timeout`) unchanged.
- `tools/monitor.ps1`: rewritten to use `[System.IO.FileSystemWatcher]` with `NotifyFilter = LastWriteTime`; `WaitForChanged` replaces the 1-second poll loop; output contract unchanged; sleep-loop fallback retained in the `.sh` script for non-.NET environments.

### Fixed

- **`last_received` reminder timer no longer resets on ambiguously-routed messages**: `routeToSession` now calls `notifyLastReceived` only for targeted routing (explicit reply-to, callback, or reaction on an owned message); governor and broadcast paths no longer update the `last_received` clock, so `only_if_silent: true` reminders fire correctly even when the operator messages other sessions during the quiet window (fixes task 30-2300)
- `channel.ts` `_send`: corrected MCP SDK call from non-existent `sendNotification()` to `notification()` on the underlying `Server` instance — channel push notifications were silently failing before this fix
- `scheduleRetry` (`file-state.ts`): wrapped `setTimeout(async () => {...})` in `void (async () => {...})()` to satisfy `no-misused-promises` lint rule
- `handleChildForward`, `handleRevokeChild`: removed erroneous `async` keyword — both functions are synchronous; test callsites updated accordingly
- `replaceActivityFile` (`file-state.ts`): added same-path guard — when the new registration reuses the same file path as the old entry, the old TMCP-owned file is no longer unlinked (would have deleted the currently-registered file)
- `replaceActivityFile` (`file-state.ts`): old debounce timer is cancelled before async cleanup, preventing a stale callback from firing a kick against the replacement entry (timer generation check)
- Kick debounce minimum lowered to 1 s (was 30 s) — allows fast-cycling agents to set sub-30 s debounce windows via `profile/kick-debounce`

### Tests

- `src/channel.test.ts`: 21 tests covering `INBOX_URI_RE`, `isChannelActive`, `registerChannelSubscriber` (cap/no-cap/exact boundary), `unregisterChannelSubscriber` (no-op, prior restoration), `notifyChannelSubscriber` (no subscriber, in-flight skip, immediate fire, cooldown suppression, retry on rejection, expired-cooldown re-fire), and `resetChannelCooldown`
- Added test 9: `replaceActivityFile` atomic swap — concurrent `touchActivityFile` call during replace reaches the new entry, not `undefined`
- Added test 10: `replaceActivityFile` timer generation check — old debounce timer cancelled by replace does not fire a stale kick against the new entry

## v7.4.0-review-fixes — in-branch

### Fixed

- `GET|POST /dequeue` async Express handler: added `try/catch` with `next(err)` to prevent unhandled promise rejections crashing Node (Express 4 does not auto-handle async route errors)
- `GET|POST /dequeue`: removed undocumented `connection_token` pass-through that was accepted but silently ignored; callers needing duplicate-session detection must use the MCP `dequeue` tool
- `handleNameTag` (`action(type: "name-tag/set")`): added backtick validation — name tags containing `` ` `` are now rejected with `INVALID_NAME_TAG` to prevent broken Markdown in message headers
- `import_profile` Zod schema: added backtick and newline regex to `name_tag` field validation
- `applyProfile`: added `nametag_emoji` fallback — profiles saved with the old field name are now correctly migrated to `name_tag` instead of being silently dropped
- `ActivityFileState`: removed phantom `absorbedCount` field that was marked as a legacy no-op on a brand-new file; all object literals updated accordingly
- `validateFilePath`: path-traversal check now splits on path separators before matching `..` — prevents false positives on paths containing `..` as a substring (e.g. `/var/log/tmcp..lock`)
- `appendNewline` in `file-state.ts`: replaced `console.warn` with `dlog("tool", ...)` for consistency with the rest of the codebase

### Changed

- `resolveNameTag` extracted as a shared export from `name-tag.ts` and used by `outbound-proxy.ts#buildHeader` — eliminates the duplicated `name_tag ?? color ?? name` resolution expression
- `parseIntParam` extracted as a file-local helper in `dequeue-endpoint.ts` — removes the duplicated inline parse expression for token and max_wait
- `file-state.ts` module doc rewritten to accurately describe the actual state machine; removed false references to non-existent `MAX_INTERVAL_MS` and `ACTIVITY_SUPPRESS_MS` constants

## v7.2.2 — 2026-04-25

### Added

- `recovering` built-in animation preset — 4-frame dot-family animation showing "recovering" with a single dot drifting outward from the word; signals post-compaction recovery window.

### Changed

- `compacting` built-in animation preset replaced with a 4-frame dot-family animation (single dot drifting inward, with one empty frame). Previously was a single static `👨‍💻 compacting...` frame.
- `POST /event` governor side-effect: removed the hardcoded `KIND_ANIMATION` kind->preset mapping. Convention is now preset name == event kind. The `compacted` kind keeps a special path: cancel any active animation, then show the `recovering` preset with a 60-second timeout. Other kinds look up a preset matching their name; missing presets are a silent no-op.

## v7.2.1 — 2026-04-25

### Fixed

- Test type-correctness: tightened mock signatures to match production void/typed return types in `built-in-commands.test.ts`, `event-endpoint.test.ts`, `event-endpoint.integration.test.ts`, `callback-edge-cases.test.ts`, and `session_status.test.ts`. No production code changes.

## v7.2.0 — Unreleased

### Added

- `POST /event` endpoint: external event system for cross-participant lifecycle signaling. Any participant POSTs `{ kind, actor_sid?, details? }` with a session token; the bridge logs the event to `data/events.ndjson`, fans out an `agent_event` service message to all active sessions, and triggers kind-mapped animations for governor actors (`compacting` → `working` preset; `compacted` → cancels active animation immediately). Strict kind allow-list: `compacting`, `compacted`, `startup`, `shutdown_warn`, `shutdown_complete` — unknown kinds return 400. `help(topic: 'events')` for full reference.
- `action(type: "react")` emoji alias fallback: when an emoji Telegram does not support as a reaction is requested, the bridge remaps to a semantically similar supported emoji (`👂→👀`, `🤚→👍`, `🧠→🤔`, `👁→👀`, `🦻→👀`), applies the reaction, and returns `hint: "emoji_alias_applied"` with the substituted emoji. Unmapped unsupported emojis still return `REACTION_EMOJI_INVALID`.
- `send(type: "choice")` callback two-stage UX: on button tap, the chosen button highlights (primary style, all others reset to default) for ~500 ms, then the keyboard collapses and the message updates with the standard selection suffix — provides visual confirmation before auto-collapse.
- `response_format: "compact"` parameter added to `dequeue`, `send`, `ask`, `choose`, `confirm`, and `send_new_checklist`: suppresses always-inferrable fields (e.g. `empty: true` on empty polls, `timed_out: false` on answered prompts, `split: true`/`split_count` on multi-chunk sends) to reduce per-call response size — estimated savings of ~445 tokens per session; `timed_out: true` is always emitted in compact mode so timeout detection remains unambiguous

### Changed

- `send` audio default: TTS sends with `audio` param are now **async by default** — returns `message_id_pending` + `status: queued` immediately; result delivered via `dequeue` `send_callback` event. Pass `async: false` to opt back into synchronous behavior. Non-audio sends unchanged (task 10-820).

### Fixed

- `send(type: "question", choose: [...])`: inline keyboard is now removed in the same edit that records the answer; previously the keyboard remained visible and tappable after selection, allowing stale taps to re-fire against an already-resolved question.
- `hook-animation.ts`: updated import path for `handleShowAnimation` from removed `tools/show_animation.ts` to `tools/animation/show.ts`
- `hook-animation.test.ts` / `hook-animation.integration.test.ts`: updated mock and `importActual` paths to match the new module location; fixed `no-confusing-void-expression` lint errors in `server.close` callbacks
- `tools/acknowledge/query.test.ts`, `tools/message/delete.test.ts`: removed unused `parseResult` imports
- `tools/send.test.ts`: added `async: false` to four audio-path response_format tests that were routing to the async/queued path instead of the synchronous path
- Async voice send now shows the Telegram recording indicator continuously across batched audio jobs to the same chat (per-chat refcount in `async-send-queue.ts`); typing emission is suppressed while audio is in flight via new `pauseTypingEmission` / `resumeTypingEmission` API in `typing-state.ts`; sync voice path also participates via `acquireRecordingIndicator` / `releaseRecordingIndicator` in `tools/send.ts`; 120 s safety bound force-clears stuck indicators

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
- `tasks/claim.ps1` / `tasks/claim.sh` — Replaced with canonical shared versions using `git mv` for atomic claim (no `GIT_INDEX_FILE` manipulation required; index atomicity provided by `git mv`); `TaskFile` parameter is now optional (scans queue by priority if omitted); rollback via reverse `git mv` on commit failure; added `tasks/claim.spec.md` design specification
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
