# [Unreleased]

## Added

- Added `mcp-config.example.json` as a reference config template
- Added async wait etiquette section to `telegram-communication.instructions.md`
- Added `update_checklist` tool for editing existing checklists in-place (split from `send_new_checklist`)
- Added 👀 reaction rules table to `docs/behavior.md`

## Changed

- Updated `LOOP-PROMPT.md` casing reference in `.github/copilot-instructions.md`
- Changed `working`, `thinking`, and `loading` builtin animation presets to use `[···word···]` bracket delimiter style
- Split `send_new_checklist` (create-or-update) into two focused tools: `send_new_checklist` (create-only) + `update_checklist` (edit-only, required `message_id`)

## Fixed

- Fixed potential crash in `setup.ts` when channel post has no `from` field (added optional chaining `u.message.from?.id`)
- Fixed per-iteration `AbortSignal` listener accumulation in `dequeue_update.ts` and `ask.ts` (hoisted `abortPromise` outside loop)
- Fixed misleading JSDoc in `temp-reaction.ts`: omitting `restoreEmoji` restores the previous recorded reaction, not removes it
- Fixed comment in `gen-build-info.mjs` to reflect actual output path `dist/tools/build-info.json`
- Fixed wrong error code `BUTTON_DATA_INVALID` on hard label-length check in `send_choice.ts` — now `BUTTON_LABEL_EXCEEDS_LIMIT`
- Fixed `append_text` silently treating non-text messages as empty string — now returns `MESSAGE_NOT_TEXT` error for non-text content types
- Fixed `get_chat` returning `toError` for consent denial/timeout — now returns structured `{ approved: false, timed_out: true|false, message_id }` so callers can branch on outcome
- Removed UTF-8 BOM from `LOOP-PROMPT.md`
- Promoted inline regex literals in `markdown.ts` to named module-level constants (`MCP_BACKSLASH_STASH`, `MCP_MARKDOWN_UNESCAPE`)
- Promoted remaining major inline regexes in `markdownToV2` to named constants (`FENCED_CODE_BLOCK`, `FENCED_CODE_UNCLOSED`, `BLOCKQUOTE_LINE`, `ATX_HEADING`)

- Fixed animation default timeout being only 2 minutes — changed to 10 minutes (600 s) in both `show_animation.ts` and `animation-state.ts`
- Fixed `show_animation` not firing `fireTempReactionRestore` when a new animation message is created — temp reactions are now cleared as expected
- Fixed `unpin_message` passing `undefined` as second arg to `unpinChatMessage` when no `message_id` given — now calls with no args to unpin most recent
- Fixed `send_new_checklist` accepting both create and update in one tool — split into `send_new_checklist` (create-only) and `update_checklist` (edit-only)
- Fixed `setSessionLogMode` accepting invalid numeric values — now validates, floors, and clamps to ≥ 1 before saving
- Fixed `gen-build-info.mjs` writing to a directory that may not exist — added `mkdirSync({ recursive: true })` before write
- Fixed `renderProgress` not clamping `width` — now enforces minimum of 1 character
- Fixed `append_text` error code literal lacking `as const` narrowing

## Docs

- Audited all 37 tool descriptions for disambiguation and cross-references
- Clarified `notify` vs `send_text` usage (severity styling vs conversational replies)
- Clarified `edit_message` over `edit_message_text` (legacy) for all text edits
- Clarified `answer_callback_query` is only needed for manual `send_message` keyboards — `choose`/`confirm`/`send_choice` auto-ack
- Clarified `transcribe_voice` is only for re-processing — `dequeue_update` pre-transcribes voice
- Added cross-references: `session_start` ↔ `get_agent_guide`, `send_new_checklist` ↔ `send_new_progress`, `show_animation` ↔ `show_typing`
- Clarified `send_message` does not auto-split (use `send_text` for long messages without keyboard)
- Fixed `ackVoiceMessage` unconditionally calling `trySetMessageReaction` — now a no-op when the message already has the `🫡` reaction recorded

- Fixed orphaned `setTimeout` handles in `dequeue_update` and `ask` loop iterations — timer is now cancelled with `clearTimeout` after the `Promise.race` resolves
- Fixed `snake_case` local variable names in `get_me.ts` — renamed `mcp_commit`/`mcp_build_time` to `mcpCommit`/`mcpBuildTime`; wire-format output field names are unchanged
- Fixed `send_text_as_voice` leaking typing indicator after voice delivery — `cancelTyping()` is now called in a `finally` block
- Fixed `dump_session_record` MCP tool not advancing the dump cursor — now calls `advanceDumpCursor()` after every successful send so shutdown dump only covers new events
- Fixed shutdown auto-dump re-sending already-seen events — now uses incremental mode (`doTimelineDump(true)`)
- Fixed incremental dump emitting "no events captured" noise on shutdown — empty incremental dumps are now silent
- Fixed session panel "Dump" button using full-timeline dump — now incremental (consistent with cursor tracking)
- Fixed broken `U+FFFD` replacement character in session panel "Dump" button label — replaced with correct 🗒 emoji
- Renamed "Session Log" → "Session Record" throughout UI strings and changed panel/file emoji from 📼 to 🗒

- Fixed `BUTTON_DATA_INVALID` error code in `edit_message` button label validation — renamed to `BUTTON_LABEL_EXCEEDS_LIMIT` (consistent with `send_choice`)
- Fixed `edit_message` skipping `validateText` before calling Telegram API — now validates resolved text length/emptiness and returns a structured error
- Fixed `append_text` returning a plain string to `toError` for `MESSAGE_NOT_TEXT` — now returns a structured `{ code, message }` object so callers get a stable error code
- Fixed `confirm` callback hook in single-button CTA mode — now ignores callback data that is neither `yes_data` nor a valid `no_data` (prevents calling `ackAndEditSelection` with empty label)
- Fixed `pin_message` passing `undefined` to `unpinChatMessage` when no `message_id` given — now calls `unpinChatMessage(chatId)` with no ID to unpin the most recent pin
- Fixed `gen-build-info.mjs` failing when `dist/tools/` doesn't exist — now calls `mkdirSync` with `{ recursive: true }` before writing
- Fixed `setSessionLogMode` accepting invalid numeric values (e.g. 0, -1, NaN) — now validates and clamps to integer >= 1, falls back to `null`
- Fixed `renderProgress` crashing when `width <= 0` — now clamps `width` to at least 1
- Fixed `append_text` `MESSAGE_NOT_TEXT` error code missing `as const` — literal type now preserved on the wire
- Enabled Docker Scout critical/high vulnerability display in `.vscode/settings.json` (was incorrectly disabled)

## Removed

- Removed `mcp-config.json` from version control (now gitignored; copy from `mcp-config.example.json`)

