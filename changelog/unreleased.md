# [Unreleased]

## Added

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
- Added `routing-mode` module — configurable routing for ambiguous messages (load_balance, cascade, governor)
- Added `/routing` built-in command — inline panel to view and switch routing mode (load balance / cascade / governor)
- Added `dm-permissions` module — directional permission map for inter-session DMs (sender→target, operator-gated)
- Added `send_direct_message` tool — send internal-only messages to another session (requires auth + DM permission)
- Added `request_dm_access` tool — request operator permission to DM another session via confirmation prompt
- Added `deliverDirectMessage` in session-queue — synthetic `direct_message` events injected into target queue (negative IDs to avoid collision)
- `close_session` now revokes all DM permissions for the closed session
- Added `pass_message` tool — forward an ambiguous message to the next session in cascade order (cascade mode only)
- Added `route_message` tool — governor delegates a message to a specific target session (governor mode only)
- Added `passMessage` and `routeMessage` functions in session-queue — re-deliver events from the message store to another session's queue
- Added governor death recovery — closing the governor session resets routing mode to load_balance and notifies the operator
- Added cascade pass-by deadlines — cascade-routed events include a `pass_by` ISO timestamp (15 s for idle sessions, 30 s for busy)
- Added session directory to `session_start` — when `sessions_active > 1`, response includes `fellow_sessions` (list of other sessions) and `routing_mode`
- Added auto-routing prompt — when the 2nd session joins, `session_start` sends the routing mode selection panel to the operator automatically (previously required manual `/routing` command)
- Added Claude Code Docker config example to README
- Added Claude Code configuration instructions (project-scoped `.mcp.json`) to setup guide and README
- Added Kokoro quick-start guide to README — Docker pull, env vars, `/voice` panel, and voice table
- Added troubleshooting entry for multiple instances competing for the same bot token
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

## Changed

- `session_start` no longer asks "Resume / Start Fresh" — always auto-drains pending messages from previous sessions (start fresh) without operator interaction
- `session_start` intro message now includes session identity (SID and name) when multiple sessions are active or a name is provided
- Softened session-start hint from prescriptive "Requires an active session — call session_start once before using this tool" to subtle "Ensure session_start has been called" across all 12 tool descriptions
- Softened `send_text` session hint to clarify session_start is recommended, not enforced
- Pending-updates guard on blocking tools now auto-bypasses when `reply_to_message_id` is set (targeted replies don't need queue draining)
- Updated pending guard description in blocking tools to document the reply-to exception
- Restored `@tsdotnet/queue` dependency — replaces hand-rolled `SimpleQueue<T>` inline class; uses `Queue<T>` directly (upstream 1.3.x ships `.js` extensions in `.d.ts` files natively)
- Refactored `message-store` to delegate queue operations to `TwoLaneQueue<T>` — inbound events are also routed to per-session queues via `routeToSession`
- Ambiguous inbound messages now use load-balance routing (round-robin among idle sessions) instead of broadcast when multiple sessions are active
- Implemented cascade routing mode — always prefers lowest-SID idle session (priority hierarchy), falls back to lowest SID
- Implemented governor routing mode — routes ambiguous messages to the designated governor session only
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

## Fixed

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
- Fixed multi-session.md overstating auth coverage — clarified that only session-management tools require `sid`/`pin`
- Fixed missing branch coverage in 6 tool files (`delete_message`, `edit_message_text`, `send_choice`, `send_new_checklist`, `send_new_progress`, `update_progress`) — added resolveChat error, validateText failure, boolean API result, and button label limit tests; branch coverage 82.43% → 83.27%
