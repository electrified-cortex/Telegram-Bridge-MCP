# Changelog

All notable changes to this project will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

## [2.1.2] — 2026-03-11

### Changed

- **`send_temp_message` TTL** — default raised from 30 s to 300 s (5 minutes); maximum raised from 300 s to 600 s (10 minutes)
- **`clearPendingTemp` grace period** — instead of deleting immediately when any outbound tool fires, the temp message now lingers for 10 seconds so the user can still read it if the real response arrives fast

## [2.0.0] — 2026-03-07

### Fixed

- **Docker build**: `prepare` script now uses `|| true` so it doesn't fail when `git` is not available in the container build environment

### Added

- **ESLint v10 + typescript-eslint** — `eslint.config.js` (flat config) with `no-explicit-any`, `no-non-null-assertion`, and `no-unused-vars` (with `_` prefix ignore pattern); `pnpm lint` script added to `package.json`

### Changed

- **Eliminated all 199 ESLint errors** — Zero `as any` casts remain in the codebase:
  - `telegram.ts`: imported `ApiError` from `grammy/types`; `sendVoiceDirect` error construction uses `as ApiError`; `pollUntil` `allowed_updates` cast uses `ReadonlyArray<Exclude<keyof Update, "update_id">>`
  - `get_update.ts`, `get_updates.ts`: `allowed_updates` cast replaced with named type (`ReadonlyArray<Exclude<keyof Update, "update_id">>`)
  - `edit_message_text.ts`: `reply_markup` cast changed from `as any` to `as unknown as InlineKeyboardMarkup | undefined` with comment explaining discriminated-union mismatch
  - `set_reaction.ts`: imported `ReactionType` from `grammy/types`; `reaction` array typed as `ReactionType[]`; `ReactionEmoji` imported from `telegram.ts`; `as any` removed
  - `send_voice.ts`: `msg.voice?.field` — `as any` removed (grammy's `Voice` type is complete)
  - `update_status.ts`: `(edited as any).message_id` — removed cast (both union members have `message_id`)
  - `update-sanitizer.ts`: `u.message_reaction` accessed directly (exists in `@grammyjs/types@3.24.0`); `ReactionTypeEmoji` imported for typed filter predicate; `msg.poll.options.map(o => o.text)` — `(o: any)` removed
  - `test-utils.ts`: `parseResult` return type changed from `unknown` to `Record<string, unknown>`; `createMockServer` return type changed to `MockServer & McpServer` with `as unknown as MockServer & McpServer` cast + comment; all test files updated — `register(server as any)` → `register(server)`, `parseResult(result) as any` → `parseResult(result)`
  - `telegram.test.ts`: `makeGrammyError` accepts optional `parameters?: ResponseParameters`; GrammyError constructor now includes `parameters` — eliminates all `(err as any).parameters =` assignments; `makeMessageUpdate`/`makeCallbackUpdate` return `Update` via `as unknown as Update`; `noSender`/`noChatMsg` same pattern; `(result as any).code` → `(result as TelegramError).code`; `{ update_id: n } as any` → `as unknown as Update`; removed unused `escapePath` variable
  - `tts.test.ts`: `vi.mocked(decode as any)` / `vi.mocked(pipeline as any)` → `vi.mocked(decode)` / `vi.mocked(pipeline)` (test files excluded from `tsconfig.json`; esbuild strips types)
  - Five polling test files (`ask`, `choose`, `send_confirmation`, `wait_for_message`, `wait_for_callback_query`): `pollUntil` mock typed with `matcher: (updates: Update[]) => unknown`; `(u: any)` filter callbacks typed; `mocks.getUpdates()` cast to `Update[]`
  - `session_recording.test.ts`: `[] as any[]` replaced with `(): SessionEntry[] => []` / `(): Update[] => []` with proper imports
  - `get_update.test.ts`: `drainN: vi.fn(() => [] as any[])` typed as `(): Update[] => []`; spread passthrough simplified to `(n: number) => bufferMocks.drainN(n)`
  - `setup.ts`: removed dead `readEnv()` function (defined but never called)
- **Updated TypeScript standards doc** — Added `Linting` section with ESLint setup, three enforced rules, and suppression policy (`as unknown as T` over `as any`; `eslint-disable-next-line` only with explanation)

### Changed

- **Extracted all inline regex literals to named module-level constants** — 28 constants in `tts.ts` (`RE_ESCAPE_NEWLINE`, `RE_FENCED_CODE`, `RE_HTML_B`, `RE_TRAILING_SLASH`, etc.); `RE_BOT_COMMAND` in `set_commands.ts`; trailing-slash removal in `transcribe.ts` replaced with `endsWith`/`slice` string method
- **Code quality pass across 12 files** — guard clauses, no-else-after-return, ternaries, vertical dot chains, line-length (<100 chars), and deduplication:
  - `telegram.ts`: `advanceOffset` uses early return; `classifyGrammyError` and all validators split long return objects vertically; `validateCaption`, `validateCallbackData`, `validateText`, `validateTargetChat`, `resolveChat` refactored to guard-clause / positive-first pattern; `getApi()` and `getSecurityConfig()` use guard-clause + return-assignment; `SecurityConfig.userId` typed as `number` (`0` = no filter) — `> 0` check replaces null checks throughout; extracted `resolveMediaSource()` utility (path guard + http/https/file_id dispatch) shared by `send_document`, `send_audio`, `send_video`
  - `send_document.ts`, `send_audio.ts`, `send_video.ts`: now use `resolveMediaSource()` — 30 lines of duplicated path/URL validation replaced with a 3-line call
  - `ask.ts`: renamed `chatErr` → `textErr`; removed redundant `?? undefined` from `reply_to_message_id`; split long voice-branch return
  - `get_update.ts`: replaced `Awaited<ReturnType<typeof filterAllowedUpdates>>` with `Update[]`; extracted hint ternary to named const
  - `button-helpers.ts`: extracted private `appendSuffixAndEdit` helper — `editWithTimedOut`, `editWithSkipped`, and `ackAndEditSelection` now share it; split two long return objects in `pollButtonOrTextOrVoice`; `getApi().answerCallbackQuery().catch()` chain made vertical
  - `markdown.ts`: added `V2_SPECIAL_CHAR` non-global regex for single-char `.test()` — eliminates `lastIndex = 0` reset after each use
  - `tts.ts`: renamed inner `body` shadow variable → `errorBody` in `synthesizeHttpToOgg`; `getLocalPipeline()` uses guard-clause + return-assignment
  - `transcribe.ts`: extracted `canReact` boolean — eliminated duplicated guard in `transcribeWithIndicator`; `getApi().setMessageReaction().catch()` chains made vertical; `getPipeline()` uses `??=` (nullish coalescing assignment)
  - `typing-state.ts`: added `TypingAction` type alias for the union; extracted `unrefTimer()` helper — replaced 3 repeated inline guards
  - `topic-state.ts`: `applyTopicToTitle` two-branch if/return → ternary
  - `update-buffer.ts`: `drainN` — removed intermediate `taken` variable, direct return
  - `session-recording.ts`: extracted `pushEntry()` helper — `recordUpdate` and `recordBotMessage` no longer duplicate the cap-and-push logic
  - `update-sanitizer.ts`: all 11 long single-line return objects split vertically; unused `direction` binding renamed → `_direction`
  - `download_file.ts`: `isTextFile` inner `if (fileName)` block flattened to single-line guard

- **`chatId` type hardened to `number` throughout** — `SecurityConfig.chatId` changed from `string | null` to `number` (`0` = no filter, consistent with `userId`); extracted private `parseEnvInt(envVar): number` helper shared by both fields (returns `0` for unset/invalid, warns on invalid); `resolveChat()` now returns `number | TelegramError` (was `string | TelegramError`), eliminating all `String()` / `parseInt()` casts at call sites; `trySetMessageReaction(chatId)` parameter changed from `string` to `number`; all 23+ outbound tool files updated — type guards changed from `typeof chatId !== "string"` to `typeof chatId !== "number"`; `temp-message.ts` `PendingTemp.chatId: number`; `button-helpers.ts` all helper functions accept `chatId: number`, `String(id) === chatId` comparisons replaced with direct `id === chatId`

- **Added TypeScript standards instruction file** — `.github/instructions/typescript-standards.instructions.md` documents project-wide conventions (guard clauses, type narrowing, sentinel values, etc.) for Copilot and contributors

### Fixed

- **Identifier underscores no longer rendered as italic**: underscores bounded by word characters (e.g. `STT_HOST`, `my_var`) are now escaped in `markdownToV2` instead of triggering italic formatting — prevents cross-word pairing like `TTS_HOST … STT_HOST` from accidentally italicising the text between them

### Security

- **Path traversal in `send_document`, `send_audio`, `send_video`**: local file reads now restricted to `SAFE_FILE_DIR` (`$TMPDIR/telegram-bridge-mcp`); paths outside are rejected
- **Rejected plain HTTP URLs in media send tools**: `send_document`, `send_audio`, `send_video` now reject `http://` URLs — HTTPS required to prevent interception in transit
- **Filename collision in `download_file`**: saved filenames now include a `Date.now()_` prefix to prevent silent overwrites; returned `file_name` field remains the original name
- **CSPRNG for pairing code**: `setup.ts` now uses `crypto.randomInt()` instead of `Math.random()` for pairing code generation
- **BOT_TOKEN redacted in setup output**: `pnpm pair` no longer prints the full token to the terminal — only the first 8 chars are shown
- **TTS/STT error bodies no longer forwarded to LLM**: raw server error responses from TTS/STT providers are now logged to stderr only; a generic message is returned to the agent
- **`filterAllowedUpdates` covers `message_reaction` and `my_chat_member`**: these update types now have sender/chat ID extracted and filtered against `ALLOWED_USER_ID`/`ALLOWED_CHAT_ID`
- **`send_confirmation` validates callback data length**: `yes_data` and `no_data` are now validated against the 64-byte Telegram limit before sending
- **Supply chain / behavior guide integrity note**: documented in `SECURITY-MODEL.md` that `BEHAVIOR.md` is loaded verbatim into agent context; tampered content would inject instructions
- **HTTPS startup warning for TTS/STT hosts**: server now emits a `[warn]` to stderr at startup if `TTS_HOST` or `STT_HOST` is set but does not use `https://`

---

## [1.16.0] — 2026-03-07

### Security

- **Auth bypass fix**: `filterAllowedUpdates` now default-denies updates with undefined sender ID (channel posts, anonymous admins were previously let through)
- **Path traversal in `download_file`**: filenames from Telegram are now sanitized with `basename()` and leading dots stripped before writing to disk
- **File permissions**: downloaded files written with `0o600` (owner read/write only) instead of world-readable
- **`send_voice` file restriction**: local file reads in `sendVoiceDirect` restricted to the server's temp directory; check uses `path.relative` to prevent prefix-bypass (e.g. `telegram-bridge-mcp2/`)
- **`filterAllowedUpdates` null-chat gap**: updates where chat ID cannot be determined now default-denied when `ALLOWED_CHAT_ID` is configured

### Removed

- **`forward_message` tool**: removed. Forwarding a message back into the same single-user chat is redundant — `pin_message` covers the intent with less API surface.

### Changed

- Upgraded base Docker image from `node:22-slim` to `node:24-slim` (even-numbered release, becomes LTS Oct 2026, better security posture than the odd-numbered 25)
- Bumped `grammy` to 1.40.1
- Bumped `@modelcontextprotocol/sdk` to 1.27.1
- Bumped `zod` to 4.3.6
- Bumped `dotenv` to 17.3.1
- Bumped `@types/node` to 25.3.3

### Added

- 25 new security tests covering `filterAllowedUpdates`, `validateTargetChat`, `resolveChat`, offset management, and `sendVoiceDirect` path restriction (400 tests total)
- `CHANGELOG.md`

### Fixed

- `u.message?.chat?.id` optional chain (was `chat.id`, would throw TypeError if `chat` absent)

---

## [1.15.1] — prior

See git history.
