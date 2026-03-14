# [Unreleased]

## Added

- **`get_me` version + build fingerprint** — response now includes `mcp_version` (semver from `package.json`), `mcp_commit` (short git SHA), and `mcp_build_time` (ISO timestamp) alongside the Telegram bot info; `scripts/gen-build-info.mjs` runs as part of `pnpm build` and writes `src/build-info.json` (gitignored), making it easy to confirm exactly which build is running after a restart
- **`set_reaction` temporary mode** — `set_reaction` now accepts optional `restore_emoji` and `timeout_seconds` parameters; when either is present the reaction becomes temporary: it auto-reverts to `restore_emoji` (or removes itself) on the next outbound action or after the timeout; if `restore_emoji` is omitted the reaction auto-restores to whatever reaction was previously set on that message (tracked via `getBotReaction` from the message store), or clears the reaction entirely if none was recorded; eliminates the 👀→🫡 manual two-step; the separate `set_temporary_reaction` tool was removed in favour of this unified API; `temp-reaction.ts` module manages the active slot and is cleared by the outbound proxy on every send/edit/file and by `show_typing` (typing signal = intent to respond)
- **`send_choice` tool** — non-blocking one-shot keyboard; sends a message with 2–8 labeled option buttons and returns `{ message_id }` immediately; on the first button press the keyboard is automatically removed and the spinner dismissed (auto-lock), while the `callback_query` event still appears in `dequeue_update` for the agent to read; use `choose` when blocking is acceptable, `send_message` for persistent keyboards
- **`keyboard-interactions.md`** — new doc formalising the four keyboard primitives (`send_message`, `send_choice`, `choose`, `confirm`), the hierarchy, button types (momentary/toggle/rotary), implementation notes; linked from `behavior.md`
- **`send_message` tool** — core send primitive; sends a message with optional inline keyboard and returns `{ message_id }` immediately (fire-and-forget); keyboard buttons arrive as `callback_query` events via `dequeue_update`; supports per-button styles, `reply_to_message_id`, `disable_notification`, and all parse modes; the foundation on which `choose` and `confirm` are built
- **`edit_message` tool** — core edit primitive; updates text, keyboard, or both on an existing message; pass `keyboard: null` to remove buttons; omit `text` to update keyboard only (calls `editMessageReplyMarkup` internally); omit `keyboard` to update text while preserving existing buttons
- **Symbol usage guide in `communication.md`** — added "Symbol usage — quiet vs loud" table clarifying when to use ✓/✗ (U+2713/U+2717, quiet inline markers) vs ✅/❌ (loud emoji, strong final outcomes)
- **`super-tools.md`** — new doc introducing the super-tools concept and listing planned super tools (`send_new_checklist`, `progress_bar`) with design notes
- **Outbound proxy** — transparent JS Proxy wrapping Grammy `Api` that handles all cross-cutting concerns (cancel typing, clear pending temp messages, animation promotion, outgoing message recording) so tool files never import those utilities directly
- **Message store** (`message-store.ts`) — always-on store replacing both `session-recording.ts` and `update-buffer.ts`; provides `recordInbound`, `recordOutgoing`, `recordOutgoingEdit`, `recordBotReaction`, `dequeue`, `dequeueMatch`, `waitForEnqueue`, `getMessage` (random-access with version history), `dumpTimeline`
- **Background poller** (`poller.ts`) — continuously calls `getUpdates`, feeds `recordInbound` into the store, auto-transcribes voice messages with ✍→📝 reaction feedback
- **`set_default_animation` tool** — set session-level default frames, register named presets, reset to built-in, or query current state
- **Built-in animation presets** — five named presets always available without `set_default_animation`: `bounce` (default tracer), `dots` (growing middle dots), `working`, `thinking`, `loading`; accessible via `show_animation(preset: "name")` or `getPreset()`; session presets shadow built-ins with the same key; `set_default_animation` (no-args query) now returns `session_presets` and `builtin_presets` fields separately
- **`reply_to` field in message store** — `EventContent` now captures `reply_to_message.message_id` from inbound messages
- **`file_id` in `EventContent`** — `buildMessageContent` now populates `file_id` for photo, video, audio, voice, document, and animation messages
- **`session_start` tool** — startup tool that sends an intro message, checks for pending messages from a previous session, and asks the operator whether to resume or start fresh via server-generated confirmation buttons
- **`CommandResult` in button helpers** — `pollButtonOrTextOrVoice` now returns slash commands as `{ kind: "command" }` instead of silently dropping them; `ask`, `choose`, and `confirm` all handle command interrupts

## Changed

- **Session log always-on dump** — `/session → Dump` now snapshots the message-store timeline as a JSON file sent to Telegram (was: opt-in text-format dump from separate recording buffer); auto-dump configurable via `/session → Auto-dump` which fires every N events; the message store is always recording — no start/stop needed; `dump_session_record` tool sends a JSON document to the Telegram chat (downloadable by both user and agent) and returns `{ message_id, event_count, file_id }`; document caption includes `file_id` in monospace for crash recovery; outbound proxy now captures `file_id` from all file sends (photo/video/audio/document) in the timeline so bot-sent documents are downloadable via `download_file`
- **`show_animation` preset parameter** — resolve animation frames by named preset key
- **`show_typing` fires temp reaction restore** — calling `show_typing` now triggers `fireTempReactionRestore()` at the start of the handler (before extend-vs-new branch), consistent with the principle that typing = intent to respond = outbound signal; previously only actual message sends cleared the 👀 reaction
- **Animation frame auto-padding** — `startAnimation` now pads all frames to equal length with U+00A0 (non-breaking space) before Markdown processing; for backtick code-span frames the NBSP is inserted inside the closing `` ` `` so Telegram preserves them in the monospace run and the cycling message stays stable width
- **Animation space normalisation** — `startAnimation` replaces all regular spaces (U+0020) with NBSP (U+00A0) in frame strings before processing, preventing Telegram from trimming trailing or internal spaces; opt out per-call with `allow_breaking_spaces: true` (also exposed as a `show_animation` tool parameter)
- **Animation promotion via proxy** — when an animation is active, text sends are intercepted: the animation placeholder is edited to show the real content and a new animation starts below; file sends use suspend/resume (delete → send → restart)
- **Animation state** (`animation-state.ts`) — manages typing/thinking animations via edit-not-delete mechanism with `startAnimation`, `cancelAnimation`, `resetAnimationTimeout`
- **`animation-state` simplified** — removed `juggleAnimation`, `suspendAnimation`, `resumeAnimation` exports; animation promotion is now handled internally via `SendInterceptor` registered with the outbound proxy
- **`send_text` tool** — replaces `send_message` with `recordOutgoing` integration and `resetAnimationTimeout`
- **`send_file` tool** — consolidates `send_photo`, `send_document`, `send_video`, `send_audio`, `send_voice` into one tool with auto-detection by file extension
- **`dequeue_update` tool** — universal update consumption; blocks via `waitForEnqueue` with configurable timeout and filter predicate
- **`get_message` tool** — random-access lookup by `message_id` with optional version history
- **`append_text` tool** — delta-append using `getMessage` + `editMessageText` + `recordOutgoingEdit`
- **`show_animation` tool** — starts a typing/thinking animation via `startAnimation`
- **`cancel_animation` tool** — cancels active animation with optional replacement text
- **`telegram.ts` split API singletons** — `getRawApi()` returns the unwrapped Grammy `Api` (for animation internals), `getApi()` returns the proxied version (for tools)
- **ESLint upgraded to `strictTypeChecked`** — switched from `recommended` to `strictTypeChecked` preset; fixed all violations across source and test files (323 → 0); follow-up pass fixed 9 remaining violations introduced by the v3 rewrite (`prefer-const`, unused import, unknown catch type, `String()` template cast, void-expression arrow functions, `no-misused-spread`, and `_state` null narrowing via local `const` capture)
- **Replaced `@tsdotnet/queue` with inline `SimpleQueue<T>`** — eliminates external dependency and fixes 33 type-resolution failures caused by pnpm strict symlinking
- **Test-file ESLint override** — relaxed `no-non-null-assertion`, `no-unsafe-*`, and `no-unnecessary-condition` for `*.test.ts` files (standard practice for mock-heavy test code)
- **Renamed `session_recording.test.ts` → `dump_session_record.test.ts`** — test file now matches the tool it tests
- **Version bumped to 3.0.0** — major architecture change from polling-per-tool to background-poller + message-store
- **`server.ts` rewrite** — registers 29 tools (down from 40+); removed all V2 polling tool imports
- **`choose.ts`** — uses `pollButtonOrTextOrVoice` from button-helpers instead of `pollUntil`; voice arrives pre-transcribed from poller
- **`ask.ts`** — complete rewrite using `dequeueMatch`/`waitForEnqueue` loop from message-store
- **`button-helpers.ts`** — rewritten with V3 types (`ButtonResult`, `TextResult`, `VoiceResult`); uses store-based polling instead of `pollUntil`
- **`confirm.ts`** — uses `recordOutgoing` and V3 `ButtonResult.callback_query_id`
- **`notify.ts`** — uses `recordOutgoing` and `resetAnimationTimeout`
- **`edit_message_text.ts`** — adds `recordOutgoingEdit` and `resetAnimationTimeout`
- **`send_text_as_voice.ts`** — uses `recordOutgoing` and `resetAnimationTimeout`
- **`update_status` renamed to `send_new_checklist`** — MCP tool name, filename, and all doc references updated; API shape unchanged (omit `message_id` to create, pass it to edit in-place)
- **`send_new_checklist.ts`** — uses `recordOutgoing` and `resetAnimationTimeout`
- **`show_typing.ts`** — absorbed `cancel_typing` via `cancel: boolean` parameter
- **`pin_message.ts`** — absorbed `unpin_message` via `unpin: boolean` parameter; `message_id` optional for unpin
- **`dump_session_record.ts`** — complete rewrite; returns JSON from `dumpTimeline`/`timelineSize`/`storeSize` (no recording needed)
- **`set_reaction.ts`** — adds `recordBotReaction` call
- **`index.ts`** — starts/stops background poller; removed `sendSessionPrefsPrompt`
- **`telegram.ts`** — removed `recordUpdate` from `advanceOffset` (poller handles recording)
- **Poller `advanceOffset` moved after processing** — offset now advances after the update loop completes, not before; prevents permanent message loss when a handler throws mid-batch
- **Poller per-update try-catch** — individual update processing failures are logged to stderr but no longer abort the entire batch
- **Poller fatal error classification** — 401/403 errors stop the poller; 429 respects `retry_after`; transient errors use 5s backoff
- **`scanAndRemove` selective notify** — `notifyWaiters()` now only fires when a match is found and the lane still has items, eliminating churn wake-ups on misses
- **Queue lane capacity limit** — `SimpleQueue.enqueue()` accepts `maxSize` (default 5000) with FIFO eviction to prevent unbounded memory growth
- **`recordOutgoingEdit` fallback preserves event type** — fallback path now sets `event: "edit"` instead of calling `recordOutgoing` which sets `event: "sent"`
- **`dequeue_update` reports real `pendingCount` on timeout** — timeout path now returns actual pending count instead of hardcoded `0`
- **`session-recording.ts` docstring** — clarified that this module is a supplementary opt-in buffer for `/session` only; `dump_session_record` reads from the message store timeline
- **`LOOP-PROMPT.md` updated** — setup flow now uses `session_start` instead of manual drain loop
- **All tool files stripped of cross-cutting imports** — `cancelTyping`, `clearPendingTemp`, `recordOutgoing`, `juggleAnimation`, `suspendAnimation`, `resumeAnimation` removed from 11 tool files; the outbound proxy handles these transparently
- **`send_confirmation` renamed to `confirm`** — aligns with the short blocking-verb pattern (`ask`, `choose`, `confirm`); `send_*` tools are non-blocking, short verbs block; the old name broke the convention
- **`send_new_progress` + `update_progress` tools** — emoji block progress bar rendered as `▓▓▓▓▓░░░░░ 50%`; `send_new_progress` creates a new message and returns `{ message_id, hint }`; `update_progress` edits it in-place; multiple concurrent bars supported, each tracked by its own `message_id`; optional `subtext` italic detail line; configurable `width` (default 10, max 40); server-stateless — all params required on every update call
- **Technical docs relocated** — pure implementation supplement docs moved next to their source files following the `src/*.ts.md` convention: `docs/v3-message-store.md` → `src/message-store.ts.md`, `docs/outbound-proxy.md` → `src/outbound-proxy.ts.md`, `docs/session-recording.md` → `src/session-recording.ts.md`, `docs/animation-spec.md` → `src/animation-state.ts.md`, `docs/animation-flow.md` → `src/animation-state.ts.flow.md`, `docs/animation-edge-cases.md` → `src/animation-state.ts.edge-cases.md`

## Fixed

- **Temporary 👀 reaction persisting after restore** — `fireTempReactionRestore` left the reaction in place when no `restore_emoji` was provided and no previous reaction was recorded; now correctly clears the reaction (calls `setMessageReaction` with `[]`) so the 👀 does not linger after the agent responds; tests updated to assert the clear is called
- **Voice reply delay in `choose`/`ask`/`confirm`** — voice messages during a blocking button wait are now recognised immediately on arrival (before transcription begins); blocking waiters wake instantly and wait only for the transcription to complete, not the full pipeline; the fix uses two-phase recording: `recordInbound` fires on arrival with no text, then `patchVoiceText` patches the transcribed text in-place once ready and notifies waiters; `send_choice` is unaffected (non-blocking)
- **`choose`/`confirm` delayed skip edit on voice** — when the user replies with a voice message instead of pressing a button, the question message (with buttons) was only edited to "⏭ Skipped" after transcription completed, causing a visible delayed flicker; `pollButtonOrTextOrVoice` now accepts an `onVoiceDetected` callback that fires immediately when a voice message arrives (before transcription); `choose` and `confirm` use this to remove the keyboard instantly; the `editWithSkipped` call is skipped on completion if it already fired
- **🫡 ack on voice messages in `ask`, `choose`, `confirm`** — only `dequeue_update` was setting the 🫡 reaction after consuming a voice message; the other dequeue paths (`ask` via `dequeueMatch`, `choose`/`confirm` via `pollButtonOrTextOrVoice`) skipped the ack, leaving ✍ stuck on the message when a waiter was pending (since the poller also skips 😴 in that case); added shared `ackVoiceMessage` to `telegram.ts` and wired it into all voice dequeue paths
- **Button style colors now actually work** — `style: "success" | "primary" | "danger"` on `choose` options and `yes_style`/`no_style` on `confirm` was not being forwarded to the Telegram Bot API; `style` IS a real `AbstractInlineKeyboardButton` field in grammy/Telegram types for native button background color; restored `style` pass-through; label text is now fully caller-controlled (no forced emoji injection)
- **`REACTION_EMOJI_INVALID` error code** — `set_reaction` was incorrectly returning `BUTTON_DATA_INVALID` when the emoji wasn't in the allowed reaction set; replaced with the correct `REACTION_EMOJI_INVALID` code; `MISSING_MESSAGE_ID` (used in `pin_message`) was also missing from the `TelegramErrorCode` union — both added; `pin_message` tests expanded to cover the missing-message-id guard and unpin paths
- **Animation stuck above messages** — animation placeholder now moves below each new outbound message via proxy-driven promotion instead of manual tool-level juggling
- **`dequeueMatch` cross-lane waiter starvation** — `scanAndRemove` skipped `notifyWaiters()` when the matched item was the last in its lane (condition `found && lane.count > 0`); if `dequeueMatch` drained the response lane, any `dequeue_update` waiter blocked on `waitForEnqueue` was never woken — even though the message lane had items ready; the condition is now simply `found !== undefined`
- **Voice 😴 reaction skipped when agent is already waiting** — poller now checks `hasPendingWaiters()` and skips the queued reaction when a `dequeue_update` waiter is pending
- **`send_file` photo broken for local files** — `case "photo"` was passing the raw path string to Grammy instead of the `InputFile` object from `resolveMediaSource`; local photo uploads silently failed with invalid file_id errors
- **`ask`/`choose` latency stall** — `scanAndRemove` (formerly `_scanAndRemove`) now calls `notifyWaiters()` after re-enqueuing non-matched items; without this, a blocking wait could stall up to the full timeout when an unrelated event was scanned while a waiter was about to register
- **Symlink bypass in path guard** — replaced `path.resolve()` with `realpathSync()` in `resolveMediaSource` and `sendVoiceDirect`; `resolve()` is lexical-only and cannot detect symlinks pointing outside `SAFE_FILE_DIR`
- **`ackVoice` double `resolveChat()` call** — now assigns to a `const` before narrowing, per "named intermediate variables" convention
- **Stale JSDoc in `poller.ts`** — removed "not yet implemented" from `🫡` phase; `ackVoice` in `dequeue_update` is implemented
- **Callback query corrupted message index** — `recordInbound` now uses `_timeline.push` for callbacks instead of `pushEvent`, preventing callback events from overwriting bot-message CURRENT entries in the index (broke `append_text` after button presses)
- **`append_text` broken on split messages** — `send_text` now stores the actual chunk content for split messages instead of the full original text, preventing accumulated-text overflow when `append_text` is called on a split chunk
- **Non-null assertions removed** — replaced `!` assertions in `button-helpers.ts` (`qid!`, `data!`, `text!`) and `poller.ts` (`u.message!`, `voice!.file_id`) with explicit guards per project linting rules
- **Stale tool descriptions** — removed references to deleted V2 tools (`wait_for_message`, `get_updates`, `wait_for_callback_query`) in `download_file`, `transcribe_voice`, `confirm`, and `choose` descriptions
- **`evictTimeline` GC pressure** — replaced `slice(length - MAX_TIMELINE)` (allocates new 1000-element array per event post-saturation) with `shift()` loop
- **Poller JSDoc** — corrected emoji mismatch in three-phase lifecycle summary (`📝` → `😴`); marked `🫡` phase as not yet implemented in `dequeue_update`
- **Animation frame cycling tests** — updated test expectations to include `{ parse_mode: "MarkdownV2" }` argument that `cycleFrame` passes after resolving through `resolveParseMode`
- **Voice transcription timeout** — added 60s timeout to `transcribeVoice` calls in the poller; prevents ✍ reaction from sticking forever when transcription hangs
- **Transcription timeout timer leak** — fixed dangling `setTimeout` in `_transcribeAndRecord`; the timer is now cancelled via `clearTimeout` in a `finally` block regardless of whether transcription succeeded or timed out, preventing stale `reject()` calls from firing as unhandled rejections (fatal in Node ≥15)
- **Invalid reaction emoji** — changed poller queued-reaction from 📝 (not in Telegram's allowed set) to 😴
- **Markdown backslash escaping** — `markdownToV2` now strips agent-escaped special chars (`\_` → `_`, `\*` → `*`, etc.) before applying MarkdownV2 escaping
- **`confirm` skip flow** — switched from `pollButtonPress` to `pollButtonOrTextOrVoice`; voice/text replies now return `{ skipped: true, text_response }` instead of timing out
- **Context bloat in `get_message`** — removed `raw` field that leaked full Telegram Message/CallbackQuery objects (2–5 KB each)
- **Context bloat in `dump_session_record`** — added `limit` parameter (default 100, max 1000) and compact JSON output; prevents unbounded 500 KB responses
- **`send_file` voice http:// rejection** — voice type now consistently rejects `http://` URLs through `resolveMediaSource` instead of silently bypassing the check
- **`confirm` command handling** — slash commands during a confirmation now return `{ skipped: true, command, args }` instead of causing a type error
- **Stale built-in commands on startup** — built-in commands (`/shutdown`, `/session`, `/version`) sent before the server started are now silently discarded; prevents a queued `/shutdown` from killing a freshly-restarted server in a loop
- **Animation promotion incorrect `reply_markup` bypass** — removed erroneous `hasReplyMarkup` check from the animation `beforeTextSend` interceptor; `editMessageText` handles inline keyboards fine — only `reply_parameters` (reply threading) cannot be added to an existing message; messages with keyboards now promote via edit-in-place instead of unnecessary delete+send-new

## Security

- **`get_chat` consent gate** — tool now sends an inline keyboard confirmation to the user before returning any chat info; agent cannot access chat metadata (including username, first/last name, description) without explicit approval
- **`dump_session_record` PII warning** — description now explicitly states the tool dumps full conversation history including voice transcripts, file metadata, locations, and contacts; instructs agents not to call speculatively
- **`get_message` speculative probe warning** — description now restricts calls to message IDs already known to the agent session
- **Reaction PII stripped** — `update-sanitizer.ts` no longer includes `name` or `username` in `message_reaction` user objects; only the numeric user ID is forwarded to the agent
- **security-model.md** — added User Privacy & PII section documenting all privacy controls and the consent model

## Removed

- **17 dead V2 tool files** and **14 associated test files** — replaced by consolidated V3 tools
- **`send_message` / `send_message_draft`** — replaced by `send_text`
- **`send_photo` / `send_document` / `send_video` / `send_audio` / `send_voice`** — replaced by `send_file`
- **`get_updates` / `get_update` / `wait_for_message` / `wait_for_callback_query`** — replaced by `dequeue_update`
- **`cancel_typing`** — absorbed into `show_typing`
- **`unpin_message`** — absorbed into `pin_message`
- **`send_temp_message`** — removed (animation system replaces ephemeral messages)
- **`start_session_recording` / `cancel_session_recording` / `get_session_updates`** — replaced by always-on message store
