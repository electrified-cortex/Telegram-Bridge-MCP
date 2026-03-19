# [Unreleased]

## Changed

- Session approval keyboard now uses two rows — color buttons on row 1, `⛔ Deny` alone on row 2 — so the deny button is no longer cramped alongside 6 color emoji; deny button label updated from `✗ Deny` to `⛔ Deny`
- Removed dead `_lane` parameter from `routeToSession` — vestige of `TwoLaneQueue` era; 55 call sites across production and test files cleaned up
- `session_start` no longer sends an intro message on session creation — removed `buildIntro()`, `DEFAULT_INTRO`, `DEFAULT_RECONNECT_INTRO`, the `intro` input parameter, and `intro_message_id` from the result

- Consolidated rate-limit tracking into `rate-limiter.ts` as the single source of truth — removed duplicate `_rateLimitUntil` state from `telegram.ts`; `recordRateLimitHit`, `getRateLimitRemaining`, and `clearRateLimitForTest` in `telegram.ts` now delegate to `recordRateLimit`, `rateLimitRemainingSecs`, and `resetRateLimiterForTest` in `rate-limiter.ts`; `recordRateLimit` now accepts `number | undefined` (defaults to 5 s, matching previous behaviour)
- Removed 30 consecutive duplicate `mocks.validateSession.mockReturnValue(true)` lines from tool test files — copy/paste artifacts from the task-300 refactor

- Narrowed "all communication goes through Telegram" to be scoped to loop mode — wording updated in `telegram-communication.instructions.md` and `docs/communication.md` to clarify this applies when the operator has initiated the loop
- Added channel-precedence rule, canonical loop recipe, anti-recovery warning, and instruction-precedence hierarchy to `LOOP-PROMPT.md`
- Added "Visible Presence" and "Common Failure Modes" sections to `LOOP-PROMPT.md` and `telegram-communication.instructions.md`
- Added "Memory Safety" section to `docs/communication.md`

- `identity: [sid, pin]` is now required on **every** tool call — `requireAuth()` always validates via `validateSession()` with no single-session bypass; omitting `identity` returns `SID_REQUIRED` regardless of how many sessions are active
- `dequeue_update` migrated to `identity: [sid, pin]` format — removed legacy `session-auth.js` / `checkAuth` dependency; always uses `getSessionQueue(sid)` with no global message-store fallback
- Pattern A tools (`close_session`, `route_message`, `rename_session`, `send_direct_message`) migrated from `{ sid, pin }` to `{ identity: [sid, pin] }` parameter shape
- All 35 Pattern B tools have `identity` schema updated to `.optional()` with descriptive text; auth response is structured `SID_REQUIRED`/`AUTH_FAILED` error instead of a Zod validation error
- `session-gate.ts` — removed `activeSessionCount()`/`getActiveSession()` single-session bypass; `requireAuth(undefined)` always returns `SID_REQUIRED`
- `session_start` approval dialog now presents a color-picker keyboard — operator selects a color (🟦🟩🟧🟪🟥🟨) to approve instead of plain ✓/✗ buttons; chosen color is assigned to the session; `getAvailableColors(hint?)` in `session-manager.ts` returns palette colors not already in use with optional hint ordering; post-decision message is edited to show the selected color and session name
- `PENDING_UPDATES` guard error in `confirm`, `ask`, and `choose` now includes a `breakdown` object with counts by content type (text, voice, reaction, etc.) and an enriched message mentioning `ignore_pending: true`; `peekCategories(getType)` added to `TemporalQueue` for non-destructive type counting; `peekSessionCategories(sid)` exported from `session-queue.ts`

- Replaced `TwoLaneQueue` with `TemporalQueue` — events are now delivered in strict arrival order; heavyweight events (user text, voice) act as temporal batch delimiters instead of having separate lanes; `two-lane-queue.ts` is now a backward-compatibility shim re-exporting `TemporalQueue`; `enqueueResponse`/`enqueueMessage` kept as deprecated aliases for `enqueue()`
- `route_message` now injects a server-stamped `routed_by` field into the event copy delivered to the target session — identifies which session SID performed the routing; cannot be forged by any agent; original event in the global timeline is unmodified
- Agent guide (`docs/behavior.md`) documents DM and routing trust boundaries: `direct_message` events are always agent-originated (never operator), `routed_by` is server-injected proof of routing attribution
- Agent guide (`docs/behavior.md`) — removed recommendation for agents to register `/dump`, `/cancel`, `/exit` commands via `set_commands`; built-in commands (`/session`, `/voice`, `/version`, `/shutdown`) are sufficient; agents should not register extra commands by default

## Fixed

- Fixed `debounceSend()` race condition — concurrent callers could both read `_lastSendAt` before either updated it, allowing messages to fire within the same rate-limit window; replaced with a promise-chain mutex that serialises all callers; `resetRateLimiterForTest()` now resets the lock to a resolved promise
- Fixed `openai-schema-compat.test.ts` shared `captured` array polluting across tests — added `beforeAll` reset hook; removed manual `captured.length = 0` inside the first test
- Fixed `requireAuth` accepting a too-short `identity` array — added `identity.length < 2` guard that returns `SID_REQUIRED` before destructuring
- Fixed `dlogOrphans` in `close_session.ts` using `process.stderr.write` directly — replaced with `dlog("session", ...)` to match logging conventions
- Fixed voice 😴 reaction suppressed for worker-session messages in multi-session — `hasAnySessionWaiter()` (checks all sessions) replaced with `hasSessionWaiterForMessage(messageId)` in `poller.ts`; new helper returns true only when the session queue that *holds this specific message* has an active waiter; governor's perpetual `dequeue_update` loop no longer causes 😴 to be skipped for every worker voice message; `TemporalQueue` gained `_pendingIds` tracking and `hasItem(id)` for O(1) ownership lookup
- Fixed `confirm.ts` pending-updates guard using `getCallerSid()` instead of the already-validated `_sid`; likewise fixed the `pollButtonOrTextOrVoice` call site in the same tool; removed dead `getCallerSid` import
- Fixed `setTempReaction` timeout losing session context — the `setTimeout` callback now passes the captured SID directly to `fireTempReactionRestore(sid?)`, preventing it from calling `getCallerSid()` inside the timer (which returns 0 with no ALS context); reaction restore now correctly targets the originating session
- Fixed misleading `renameSession` docstring in `session-manager.ts` — corrected to reflect that the function sets the name unconditionally; the uniqueness guard lives in the `rename_session` tool layer (not in the session-manager function)
- Added meaningful assertions to the "pre-check: records rate limit window when 429 is encountered" test in `telegram.test.ts` — now verifies `getRateLimitRemaining() > 0` immediately after 429 is caught and `getRateLimitRemaining() === 0` after the retry-after window elapses
- Fixed missing `governor_changed` notification on health-check reroute — when the operator clicked "Reroute to X" or "Make X primary" in the health-check panel, worker sessions were not notified of the governor switch; `health-check.ts` now loops over all active sessions (excluding the new governor) and delivers a `governor_changed` service message with `new_governor_sid` and `new_governor_name`; event type documented in `docs/inter-agent-communication.md`
- Fixed multi-session outbound name tag rendering for `parse_mode: "HTML"` in `outbound-proxy` — session headers now use `<code>Name</code>` (HTML-escaped) instead of literal backticks in `sendMessage` and `editMessageText`
- Fixed outbound name tag rendering literal backticks when no `parse_mode` is set — outbound proxy now auto-injects `parse_mode: "Markdown"` in `sendMessage` and `editMessageText` when a backtick-formatted session header is prepended but no parse_mode was provided by the caller; `buildHeader()` default branch restored to backtick formatting; `plain` field remains unformatted for captions and recording
- Fixed `sendVoiceDirect` missing session name tag — voice messages sent via the direct Telegram API path now inject the session header as a caption with `parse_mode: "Markdown"`; `buildHeader` exported from `outbound-proxy.ts` for reuse

## Changed (Shutdown)

- Implemented elegant shutdown protocol — `elegantShutdown()` in `shutdown.ts` orchestrates a graceful exit: stops the poller, waits for in-flight transcriptions, drains last-mile updates, delivers a `shutdown` service message to every active session queue, wakes blocked `dequeue_update` calls via `notifySessionWaiters()`, pauses for MCP stdio transmission, sends the operator notification, dumps the session log, clears command menus, and exits
- `/shutdown` built-in command now delegates to `elegantShutdown()` — replaced inline sequence with the shared shutdown protocol
- `shutdown` MCP tool now uses `elegantShutdown()` and adds a `force: boolean` parameter — when unprocessed messages exist in the queue the tool returns a `PENDING_MESSAGES` error unless `force: true` is passed
- Added `setShutdownDumpHook()` to `shutdown.ts` — avoids circular import by letting `built-in-commands.ts` register the session-log dump function at module load

- Stopped broadcasting `"sent"` outbound events to the governor — removed `broadcastOutbound()` call from `recordOutgoing()` in `message-store.ts`; the governor's queue now only receives ambiguous inbound messages, not every other session's outgoing chat events; `broadcastOutbound` stays exported for direct use
- Fixed ALS session context spoofing in `server.ts` middleware — `args.identity[0]` now takes priority over `args.sid` when both are present; a caller with a valid identity tuple can no longer be overridden by a bare `sid` argument
- Replaced `z.tuple([z.number().int(), z.number().int()])` identity schema with `z.array(z.number().int())` (no `.length(2)`) across all 37 tool files — Zod's tuple serialisation and `.length(N)` both produce `items` as an array that OpenAI's JSON-Schema validator rejects ("is not of type 'object', 'boolean'"); the unconstrained array form produces valid `{ items: { type: "integer" } }`; shared `IDENTITY_SCHEMA` constant in `src/tools/identity-schema.ts`; length enforced at runtime by `requireAuth()` — short arrays fail `validateSession` with `AUTH_FAILED`
- Converted `topic-state`, `typing-state`, `temp-message`, and `temp-reaction` from module-level singletons to per-SID `Map` instances — eliminates cross-session state corruption when multiple sessions are active simultaneously
- Health check no longer flags sessions with an active animation as unresponsive — an active animation is proof of life; added `hasActiveAnimation(sid)` export to `animation-state.ts`
- Service messages injected into session queues on lifecycle events — `session_joined` notifies all existing sessions when a new session joins; `session_orientation` tells the new session its role and who the governor is; `session_closed` notifies remaining sessions when a session ends; `governor_promoted` notifies the newly promoted session; events carry `from: "system"` and structured `details` for programmatic handling

## Added

- Session join broadcast announcement — on approval, the approval prompt is deleted and a visible `Session N — 🟢 Online` message is sent through the outbound proxy (which auto-prepends the session's name tag); the message is tracked with `trackMessageOwner` so operator/session replies route to the new session; `announcement_message_id` is included in the `session_joined` and `session_orientation` service event details so listeners can identify the message

- Added `get_chat_history` tool with backward paging support (`before_id`) and configurable window size (`count`, default 20, max 50); returns chronological timeline events plus `has_more` so sessions can read recent history and page older events safely using timeline position (not numeric ID order)
- Added button symbol parity validation to `choose`, `confirm`, and `send_choice` — returns `BUTTON_SYMBOL_PARITY` error when some labels have emoji and others do not; pass `ignore_parity: true` to bypass; added `button-validation.ts` shared helper with `hasEmoji()` and `validateButtonSymbolParity()`
- Added `voice_transcription_failed` service message — when voice transcription fails (timeout or API error) the server now injects a `service_message` with `event_type: "voice_transcription_failed"` into the target session queue; `details` carries `message_id`, `reason` (`service_timeout` or `service_error`), and human-readable error text; backwards compatible (patched voice event still contains `[transcription failed: ...]` text); added `deliverVoiceTranscriptionFailed()` to `session-queue.ts`
- Added server-side Telegram rate limit tracking — `callApi()` now pre-checks a rate limit window before attempting each API call; on 429 `callApi` records `_rateLimitUntil` and retries as before; subsequent calls during the window fail immediately with a `RATE_LIMITED` `GrammyError` without hitting Telegram; exported `recordRateLimitHit()`, `getRateLimitRemaining()`, and `clearRateLimitForTest()` from `telegram.ts`
- Added `openai-schema-compat.test.ts` regression test — iterates every registered tool's JSON Schema (both `draft-2020-12` and `openapi-3.0` targets), recursively walks the schema tree, and asserts no `prefixItems` or array-form `items` exist; catches any future `z.tuple()` introduction in any tool
- PIN uniqueness guaranteed across concurrent sessions — `createSession()` now loops up to 10 times to find a PIN not already held by a live session; throws if all 10 attempts collide (statistically impossible in normal operation)
- `PENDING_UPDATES` guard errors from `confirm`, `ask`, and `choose` now include a `breakdown` object (`{ text: N, voice: N, reaction: N, ... }`) with counts by content type, and the error message summarises the categories with actionable guidance to drain or pass `ignore_pending: true`; global fallback path (no session queue) still returns count-only
- `peekCategories(getType)` method added to `TemporalQueue` — non-destructive peek that counts queue items by type without consuming them
- `peekSessionCategories(sid)` exported from `session-queue.ts` — convenience wrapper that applies the `content.type` extractor for `TimelineEvent` queues

- `session_start` now validates session names — rejects names containing special characters, emoji, or non-Latin unicode; only letters (a–z, A–Z), digits, and spaces are allowed; returns `INVALID_NAME` error code; leading/trailing whitespace is trimmed before validation
- Governor health-check timer (`src/health-check.ts`) — runs every 60 s; if the governor session has not polled `dequeue_update` within 600 s (10 min), sends the operator a three-option inline keyboard prompt to reroute messages to the next available session, make it the permanent primary, or wait; non-governor unresponsive sessions produce a notification only; recovery (next poll) clears the flagged state and notifies the operator
- `touchSession(sid)` in `session-manager.ts` — records `lastPollAt` and resets `healthy = true`; called by `requireAuth()` on every authenticated tool call (not just `dequeue_update`) so any activity resets the health timer
- `markUnhealthy(sid)`, `isHealthy(sid)`, `getUnhealthySessions(thresholdMs)` in `session-manager.ts` — health state accessors used by the health-check timer
- `lastPollAt` and `healthy` fields added to the `Session` interface in `session-manager.ts`
- Removed `request_dm_access` tool — DM permission is now implicit for all approved sessions; `hasDmPermission()` always returns `true`; explicit grant/revoke tracking eliminated
- Session close teardown contract — `close_session` now: (1) drains orphaned queue items and reroutes them to remaining sessions, (2) always sends operator disconnect notification "🤖 {name} has disconnected.", (3) replaces any pending `choose`/`confirm`/`send_choice` callback hooks owned by the closing session with a "Session closed" ack so late button presses are handled gracefully
- `drainQueue(sid)` in `session-queue.ts` — returns all pending events from a session queue before removal, enabling orphan rerouting on close
- `replaceSessionCallbackHooks(sid, fn)` in `message-store.ts` — replaces all callback hooks registered by a session with a substitution function; used during teardown to install "Session closed" ack handlers
- `registerCallbackHook` now accepts an optional `ownerSid` parameter for session-level hook ownership tracking; `confirm`, `choose`, and `send_choice` pass their session SID so hooks can be cleaned up on teardown
- `docs/multi-session-protocol.md` — comprehensive routing protocol documentation covering session lifecycle, message routing decision tree, governor duties, cascade fallback, and agent guidelines

- `session_start` now rejects name collisions — returns `NAME_CONFLICT` error when a session with the same name (case-insensitive) already exists, with guidance to resume the existing session or choose a different name
- Added session approval gate — second and subsequent sessions send an operator Telegram prompt (✓ Approve / ✗ Deny) before the session is created; first session auto-approved; 60 s timeout defaults to deny (`SESSION_DENIED`); missing name on second+ session returns `NAME_REQUIRED`
- First session now defaults to name `"Primary"` when no name is provided; second+ sessions must supply an explicit name
- When a session close drops the active count from 2 → 1, `close_session` now clears the governor and delivers a DM to the remaining session: "📢 Single-session mode restored."
- All 32 non-exempt tools now require `identity` tuple `[sid, pin]` when `activeSessionCount() > 1` — returns `SID_REQUIRED` when omitted, `AUTH_FAILED` when invalid; single-session mode unchanged (backward compat)
- Added `session-gate.ts` with `requireAuth(identity)` helper — shared gate logic for all tool-level session authentication
- Outbound messages now include `🤖 {name}` session header when 2+ sessions are active — injected by outbound proxy for `sendMessage`, `editMessageText`, and file send captions; single-session mode unchanged
- `dequeue_update` events now always include `routing: "targeted"|"ambiguous"` field — targeted when replying to a known bot message, ambiguous otherwise
- `close_session` governor promotion — when the governor session closes with other sessions active, the lowest-SID remaining session is automatically promoted to governor (instead of resetting to `load_balance`)
- Added slash command routing documentation to multi-session section of `docs/behavior.md` — behavior table (targeted vs ambiguous), governor-registers-all etiquette, and naming conventions for multi-session command menus
- Added inter-session communication documentation to `docs/behavior.md` — `route_message` and `send_direct_message` detailed when/how/etiquette guidance replacing the bare coordination tools table
- Added `route_message` and `send_direct_message` to the tool selection table in `docs/communication.md`
- `docs/inter-agent-communication.md` — new comprehensive guide covering inter-agent message types (routed vs. DM vs. operator), trust boundaries (server-injected fields vs. free-form text), governor protocol and promotion, service message event types, etiquette patterns, and a complete delegation flow example; referenced from the multi-session section of `docs/behavior.md`
- `session_start` accepts `reconnect: boolean` (default `false`) — when `true`, returns `action: "reconnected"` instead of `"fresh"`, appends " (reconnected)" to the session's Telegram intro message, changes the approval prompt to read "Session reconnecting:" instead of "New session requesting access:", and includes "has reconnected" (vs. "has joined") in `session_joined` service messages delivered to fellow sessions; governor auto-set and DM auto-grant continue to work via existing mechanisms
- `rename_session` tool — renames the calling session to a new name; requires `[sid, pin]` identity; validates new name is alphanumeric (letters, digits, spaces); rejects collision with another active session (`NAME_TAKEN`); returns `{ sid, old_name, new_name }`; outbound header immediately reflects the new name on the next send; `renameSession()` added to `session-manager.ts`
- Outbound session header uses monospace name formatting (`🤖 \`Name\`\n`) in both plain and MarkdownV2 contexts — confirming task 500 header requirement (already implemented in outbound-proxy)
- Fixed voice caption topic formatting — `send_text_as_voice` now converts topic captions through `markdownToV2()` and sends with `parse_mode: "MarkdownV2"` instead of legacy `"Markdown"`; previously `**[Topic]**` rendered literally because Telegram legacy Markdown uses single asterisks for bold
- Created `docs/multi-session-prompts.md` — governor, worker, and topic discipline prompt templates with a two-session quick-start guide
- Added multi-session behavior documentation in `docs/behavior.md` and `docs/communication.md` — routing modes, ambiguous message protocol, governor responsibilities, coordination tools

- New test files: `config.test.ts` (100% coverage), `rate-limiter.test.ts` (100% coverage)
- Extended test coverage for `tts.ts`, `typing-state.ts`, `show_typing.ts`, `confirm.ts`, `choose.ts`, `dequeue_update.ts`, `session_start.ts`; total tests 942 → 1030, statements 85.4% → 90.2%, branches 76.6% → 82.4%
- Added `multi-session.integration.test.ts` — 38 integration tests proving multi-session routing, cascade pass chains, governor delegation, DM delivery, broadcast, session lifecycle, and edge cases (ownership vs queue removal, mid-close cascade skip, waiter wakeup, response-lane priority, self-DM, governor fallback) with 2–3 concurrent sessions
- Added pending-updates guard to blocking tools (`confirm`, `choose`, `ask`) — returns `PENDING_UPDATES` error when unread updates exist; pass `ignore_pending: true` to bypass
- Added "Requires an active session" hint to 12 tool descriptions (`send_text`, `send_message`, `send_choice`, `send_file`, `send_text_as_voice`, `send_new_progress`, `send_new_checklist`, `notify`, `ask`, `choose`, `confirm`, `dequeue_update`)
- Added `TwoLaneQueue<T>` class — generic two-lane priority queue extracted from message-store, backed by `@tsdotnet/queue`
- Added `session-queue` module — per-session queues with message ownership tracking and inbound routing (targeted via reply-to/callback/reaction, ambiguous via broadcast)
- `session_start` now creates a per-session queue alongside the session
- `close_session` now removes the per-session queue on closure
- `list_sessions` tool — lists all active sessions (SID, name, creation time) and indicates the active session; no auth required
- `dequeue_update` is now session-aware — reads from session queue when a session is active, falls back to global queue
- Added cross-session outbound forwarding — bot messages from one session appear in other sessions' queues
- Added `routing-mode` module — governor SID tracking for ambiguous message routing
- Added `dm-permissions` module — directional permission map for inter-session DMs (sender→target, operator-gated)
- Added `send_direct_message` tool — send internal-only messages to another session (requires auth + DM permission)
- Added `request_dm_access` tool — request operator permission to DM another session via confirmation prompt
- Added `deliverDirectMessage` in session-queue — synthetic `direct_message` events injected into target queue (negative IDs to avoid collision)
- `close_session` now revokes all DM permissions for the closed session
- Added `route_message` tool — governor delegates a message to a specific target session
- Added `routeMessage` function in session-queue — re-deliver events from the message store to another session's queue
- Added governor promotion on close — closing the governor session promotes the lowest-SID remaining session
- Added session directory to `session_start` — when `sessions_active > 1`, response includes `fellow_sessions` (list of other sessions)
- Added `hasAnySessionWaiter()` and `isSessionMessageConsumed()` to `session-queue` — poller uses these to avoid setting 😴 when any session agent is waiting or has already consumed the message
- Added test coverage for voice salute edge cases: session queue ack paths in `dequeue_update`, session waiter blind spot in poller, and `ackVoiceMessage` unit tests (dedup, no-ALLOWED_USER_ID guard, stderr on failure)
- Added Claude Code Docker config example to README
- Added Claude Code configuration instructions (project-scoped `.mcp.json`) to setup guide and README
- Added Kokoro quick-start guide to README — Docker pull, env vars, `/voice` panel, and voice table
- Added troubleshooting entry for multiple instances competing for the same bot token
- Added `src/tools/multi-session-integration.test.ts` — 22 integration tests wiring real session-manager, session-queue, and routing-mode with only the Telegram network layer mocked; covers 8 scenarios: two-session queue isolation, SID_REQUIRED/AUTH_FAILED enforcement across tools (`dequeue_update` sid-gate and `send_text` identity-gate), voice ack via session queue path, session close / governor routing reset, rapid create-close SID monotonicity, non-blocking concurrent dequeue, cross-session cascade message passing, and load-balance queue independence
- Added `debug-log` module — structured, bounded (2 000 entries) trace logger with categories (session, route, queue, cascade, dm, animation, tool); enable via `TELEGRAM_MCP_DEBUG=1` env var
- Added debug instrumentation across `session-manager`, `session-queue`, `dm-permissions`, `animation-state`, and `session-auth` — all lifecycle events, routing decisions, and DM operations are now traced
- Added `get_debug_log` tool — agent-readable access to the in-memory debug trace buffer with category filtering, count limits, and runtime toggle
- Added cursor-based pagination to debug log — entries have auto-incrementing `id`; `get_debug_log` accepts `since` parameter to fetch only entries newer than a known id, reducing token cost for polling
- Added `docs/multi-session-test-script.md` — detailed phase-by-phase manual test guide for multi-session features (6 phases, 20+ scenarios)
- Added 9 integration tests for queue isolation and delivery exactness — round-robin uniqueness, targeted routing exclusivity, session queue independence, cascade/governor single-delivery, DM confinement, mixed routing scenarios
- Added `session-context` module — per-request `AsyncLocalStorage` context for session identity; `runInSessionContext(sid, fn)` / `getCallerSid()` replace the racy global `getActiveSession()` for outbound attribution
- Added `registerTool` middleware in server — automatically injects optional `sid` parameter into every tool's input schema and wraps callbacks with `runInSessionContext`, eliminating per-tool changes
- Added `session-context.test.ts` — 8 tests covering context persistence across awaits, concurrent isolation, nested contexts, and fallback to `getActiveSession`
- Added 9 integration tests: cross-session isolation e2e (SID leak prevention, wrong-SID empty result, close-session message isolation), high-concurrency stress (50 msgs / 5 sessions, mixed routing modes), DM edge cases (non-existent session, closed session, orphaned permission, revokeAll both directions)
- Added cross-session isolation tests to `button-helpers.test.ts` and `ask.test.ts` — verify that `confirm`/`choose` button callbacks and `ask` text replies are visible only to the polling session's own queue and never to another session's poll; implementation in `button-helpers.ts`, `confirm.ts`, `choose.ts`, `ask.ts`, and `dequeue_update.ts` confirmed correct
- Added `"429 rate-limiting"` describe block to `animation-state.test.ts` — verifies that two concurrent 429 errors while a cycle is in-flight produce exactly one resume interval (not two), exercising the `clearTimeout(s.resumeTimer)` guard added in v3.1.3

## Changed

- Session name in multi-session outbound header now renders in monospace: `` 🤖 `Name` `` instead of plain `🤖 Name` — applies to `sendMessage`, `editMessageText`, and file captions
- Refactored `animation-state` to per-SID state — all animation functions now take `sid` as first parameter; presets, defaults, and resume state stored in per-SID Maps; eliminates cross-session animation conflicts
- Refactored outbound proxy interceptor to per-SID — `registerSendInterceptor(sid, fn)` and `clearSendInterceptor(sid?)` scope interceptors per session; lookups use `getCallerSid()` from AsyncLocalStorage
- Simplified `session_start` DM announcement — removed governor/routing terminology from user-facing messages; DM now reads "🤖 {Name} has joined. You'll coordinate incoming messages." instead of mentioning routing mode details
- Removed `sendRoutingPanel()` call from `session_start` — routing is now automatic and internal-only; operator no longer sees a routing mode selection panel on session join
- `session_start` no longer asks "Resume / Start Fresh" — always auto-drains pending messages from previous sessions (start fresh) without operator interaction
- `session_start` intro message now includes session identity (SID and name) when multiple sessions are active or a name is provided
- Softened session-start hint from prescriptive "Requires an active session — call session_start once before using this tool" to subtle "Ensure session_start has been called" across all 12 tool descriptions
- Softened `send_text` session hint to clarify session_start is recommended, not enforced
- Pending-updates guard on blocking tools now auto-bypasses when `reply_to_message_id` is set (targeted replies don't need queue draining)
- Updated pending guard description in blocking tools to document the reply-to exception
- Restored `@tsdotnet/queue` dependency — replaces hand-rolled `SimpleQueue<T>` inline class; uses `Queue<T>` directly (upstream 1.3.x ships `.js` extensions in `.d.ts` files natively)
- Refactored `message-store` to delegate queue operations to `TwoLaneQueue<T>` — inbound events are also routed to per-session queues via `routeToSession`
- Ambiguous inbound messages route to the governor session when set, otherwise broadcast to all sessions
- Fixed lint errors in `close_session` — removed unnecessary `async` and type assertions
- Added session manager with incrementing SIDs and 6-digit PINs (crypto.randomInt)
- Added `SESSION_AUTH_SCHEMA` and `checkAuth()` for tool-level session authentication
- Added `close_session` tool with auth validation
- `session_start` now creates a session and returns `{ sid, pin, sessions_active }`
- Added optional `name` parameter to `session_start` for topic prefixing
- Added `sid` field to `TimelineEvent` — outbound messages tagged with active session ID
- Added active session context (`setActiveSession`/`getActiveSession`) for tool-call scoping
- Improved `/voice` panel empty-state hint to mention built-in fallback and link to Kokoro setup
- Replaced VS Code-specific language with client-agnostic terms across README, LOOP-PROMPT, docs, tool descriptions, and pairing wizard output
- Reordered `multi-session-test-script.md` — targeted routing (reply-to, callback) is now Phase 1; session lifecycle moved to Phase 2; cascade and governor merged into Phase 3 (ambiguous routing); added close/rejoin and reply-to-S2 tests
- Rewrote `multi-session-test-script.md` Phase 3 and Phase 5 for governor-only routing — removed stale load-balance round-robin, cascade pass, and `/routing` panel steps; Phase 3 now covers auto-governor designation, ambiguous delivery to governor, `route_message` delegation, and governor death recovery; Phase 5 removes cascade/load-balance subscenarios; completion checklist updated accordingly; also removed stale `routing_mode` field from expected `session_start` response in Phase 1 and Phase 2

## Fixed

- Fixed middleware identity disconnect — `server.ts` middleware now extracts SID from `identity[0]` when the hidden `sid` parameter is absent, preventing outbound messages from being attributed to the wrong session when agents pass `identity: [sid, pin]` without the auto-injected `sid`; affected `buildHeader`, `recordOutgoing`, `broadcastOutbound`, and message ownership tracking
- Fixed `confirm`, `ask`, `choose` pending-updates guard using `getActiveSession()` instead of `getCallerSid()` — pending check now reads from the correct session's queue when called via `identity` auth
- Fixed `close_session` drain–close race — `drainQueue()` is now called **after** `closeSession()` succeeds; previously a failed close would leave the session alive with an empty queue, silently discarding all pending events
- Replaced silent `.catch(() => {})` handlers in `close_session` callback hook cleanup with `dlog("session", ...)` logging — `answerCallbackQuery` and `editMessageReplyMarkup` failures are now visible in the debug log instead of being silently swallowed
- Fixed `get_debug_log.ts` zod import from `"zod/v4"` to `"zod"`; replaced double-cast `CATEGORIES as unknown as [string, ...string[]]` with `as const satisfies [string, ...string[]]`
- Fixed `rename_session.ts` error code from `NAME_TAKEN` to `NAME_CONFLICT` to match central `TelegramErrorCode`; extracted inline regex to named module-level constant `VALID_NAME_RE`
- Updated `routing-mode.ts` module doc comment to reflect all three routing modes (broadcast, governor, pass-through) instead of "only governor supported"
- Added justification comment for `any[]` in `server.ts` `CallableCb` type — `any` is unavoidable here as the wrapper must accept any tool callback signature without compile-time knowledge of parameter types
- Removed duplicate `mocks.validateSession.mockReturnValue(true)` call in `send_message.test.ts`
- Updated `docs/multi-session-flow.md` to state that `identity: [sid, pin]` is required on every call (was stale "never require them")
- Updated PR #40 description to reflect implicit DM permission model and removed stale references to `request_dm_access` and `pass_message`

- Fixed multi-session 😴 race: poller now checks `hasAnySessionWaiter()` (session queues) in addition to `hasPendingWaiters()` (global queue) before setting 😴 — prevents 😴 overwriting 🫡 when an agent is blocked on a per-session queue
- Fixed multi-session consumed guard: poller's `_transcribeAndRecord` now checks `isSessionMessageConsumed()` before setting 😴 in both the success path and the transcription-failure catch block — prevents stale 😴 overwriting an agent-set 🫡 when the message was consumed via a session queue (which is never tracked by the global `isMessageConsumed`)
- Fixed multi-session queue isolation — `dequeue_update` now returns `SID_REQUIRED` error when called without `sid` and multiple sessions are active, preventing agents from silently reading another session's queue via the racy `getActiveSession()` fallback
- Fixed global queue duplication — inbound messages, callbacks, and reactions are no longer enqueued to both the global queue and the routed session queue; when session queues exist, messages go through `routeToSession()` only, eliminating the possibility of leaking messages across sessions via the unscoped global queue
- Fixed outbound message ownership tagging using wrong session in multi-session scenarios — `recordOutgoing` and `recordOutgoingEdit` now use `getCallerSid()` (AsyncLocalStorage) instead of `getActiveSession()` (global last-writer-wins), ensuring messages are attributed to the correct session even when sessions execute tool calls concurrently
- Fixed `dequeue_update` not re-syncing `_activeSessionId` before returning — concurrent tool calls from other sessions could overwrite the global during the long wait; now re-synced on every return path so subsequent tool calls (e.g. `send_text`) see the correct session context
- Fixed outbound proxy (`sendMessage`, file sends) not preserving session context across awaits — now snapshots `getCallerSid()` at call entry and passes it explicitly to `recordOutgoing`, preventing corruption by concurrent async operations
- Removed unreachable deadline check inside `setInterval` callback in `typing-state.ts`
- Simplified `_clearSlot` in `temp-reaction.ts` — removed unused `fireRestore` parameter that was never passed as `true`
- Fixed `session_start` never calling `setActiveSession` — per-session queues were created but never activated in production
- Fixed `session_start` leaving orphaned session/queue when intro message send fails — now rolls back session, queue, and active-session state
- Fixed `close_session` not resetting active session when closing the currently active session
- Fixed `removeSessionQueue` leaking `_messageOwnership` entries for closed sessions
- Fixed `set_reaction` ignoring `temporary` flag — added explicit `temporary` boolean parameter so reactions auto-revert without requiring `restore_emoji` or `timeout_seconds`
- Fixed confirm/choose buttons staying forever after timeout when user sends a text message (#27)
- Fixed pending-updates guard in `confirm`, `ask`, `choose` using global count instead of session-aware count — now checks session queue when active
- Fixed `confirm`, `choose`, `ask` polling from global queue instead of session queue — blocking tools now dequeue from the per-session queue when a session context exists, preventing cross-session event consumption
- Fixed `dequeue_update` silently falling back to global queue when explicit `sid` has no session queue — now returns `SESSION_NOT_FOUND` error
- Fixed animation-state 429 resume timer leak — multiple rate-limit retries no longer create duplicate resume timers
- Fixed rate-limiter comment claiming 100 ms debounce when actual `MIN_SEND_INTERVAL_MS` is 1000 ms
- Fixed stale "broadcast for now" comment in session-queue header — routing modes are fully implemented
- Fixed multi-session.md overstating auth coverage — clarified that only session-management tools require `sid`/`pin`; all other tools receive session identity automatically via AsyncLocalStorage context from server middleware
- Fixed duplicate `## Removed` heading in `changelog/unreleased.md` — consolidated into a single section per Keep a Changelog format
- Fixed identity-gate test bugs — corrected four test files: `get_debug_log` telegram mock now spreads actual module so `toError` is available; `send_text_as_voice` was missing `isError`/`errorCode` imports; `send_new_checklist` and `send_new_progress` identity-gate describe blocks were nested inside wrong outer describe (wrong variable in scope); `send_new_checklist` gate tests were missing required `title` arg, causing ZodError before the handler ran and leaving unconsumed `mockReturnValueOnce` state that corrupted subsequent `update_checklist` tests
- Fixed missing branch coverage in 6 tool files (`delete_message`, `edit_message_text`, `send_choice`, `send_new_checklist`, `send_new_progress`, `update_progress`) — added resolveChat error, validateText failure, boolean API result, and button label limit tests; branch coverage 82.43% → 83.27%

## Removed

- Removed redundant join DM from `session_start` — the `deliverDirectMessage` loop that sent "📢 🤖 {Name} has joined" to existing sessions was removed; the new session's intro Telegram message is already routed to existing sessions via normal poller flow
- Removed `load_balance` and `cascade` routing modes — ambiguous messages now broadcast to all sessions by default (no governor) or route only to the governor session when one is set
- Removed `pass_message` tool — cascade-mode message passing is no longer supported
- Removed `/routing` built-in command and routing inline panel — routing is now implicit (governor vs. broadcast)
- Removed `setRoutingMode`, `getRoutingMode`, `RoutingMode` type from `routing-mode.ts`; replaced by `setGovernorSid` / `getGovernorSid`
- Removed `popCascadePassDeadline`, `passMessage`, `pickRoundRobin`, `pickCascade` from `session-queue.ts`
- Removed `routing_mode` field from `session_start` response
