# [Unreleased]

## Added

- Added `mcp-config.example.json` as a reference config template
- Added async wait etiquette section to `telegram-communication.instructions.md`

## Changed

- Updated `LOOP-PROMPT.md` casing reference in `.github/copilot-instructions.md`
- Changed `working`, `thinking`, and `loading` builtin animation presets to use `[···word···]` bracket delimiter style

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
- Fixed `ackVoiceMessage` unconditionally calling `trySetMessageReaction` — now a no-op when the message already has the `🫡` reaction recorded

## Removed

- Removed `mcp-config.json` from version control (now gitignored; copy from `mcp-config.example.json`)

