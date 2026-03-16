# [Unreleased]

## Added

- New test files: `config.test.ts` (100% coverage), `rate-limiter.test.ts` (100% coverage)
- Extended test coverage for `tts.ts`, `typing-state.ts`, `show_typing.ts`, `confirm.ts`, `choose.ts`, `dequeue_update.ts`, `session_start.ts`; total tests 942 → 1030, statements 85.4% → 90.2%, branches 76.6% → 82.4%
- Added `multi-session.integration.test.ts` — 38 integration tests proving multi-session routing, cascade pass chains, governor delegation, DM delivery, broadcast, session lifecycle, and edge cases (ownership vs queue removal, mid-close cascade skip, waiter wakeup, response-lane priority, self-DM, governor fallback) with 2–3 concurrent sessions
- Added pending-updates guard to blocking tools (`confirm`, `choose`, `ask`) — returns `PENDING_UPDATES` error when unread updates exist; pass `ignore_pending: true` to bypass
- Added "Requires an active session" hint to 12 tool descriptions (`send_text`, `send_message`, `send_choice`, `send_file`, `send_text_as_voice`, `send_new_progress`, `send_new_checklist`, `notify`, `ask`, `choose`, `confirm`, `dequeue_update`)

## Changed

- `session_start` intro message now includes session identity (SID and name) when multiple sessions are active or a name is provided
- Softened session-start hint from prescriptive "Requires an active session — call session_start once before using this tool" to subtle "Ensure session_start has been called" across all 12 tool descriptions
- Pending-updates guard on blocking tools now auto-bypasses when `reply_to_message_id` is set (targeted replies don't need queue draining)
- Updated pending guard description in blocking tools to document the reply-to exception

## Removed

- Removed pnpm patches for `@tsdotnet/queue`, `collection-base`, `compare`, `exceptions` — upstream 1.3.x ships `.js` extensions in `.d.ts` files natively
- Removed `.npmrc` with `node-linker=hoisted` — no longer needed now that upstream types resolve correctly with pnpm's default symlink layout

## Fixed

- Removed unreachable deadline check inside `setInterval` callback in `typing-state.ts`
- Simplified `_clearSlot` in `temp-reaction.ts` — removed unused `fireRestore` parameter that was never passed as `true`

## Added

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
- Added `.npmrc` with `node-linker=hoisted` — flattens `node_modules` for reliable type resolution across transitive deps
- Added `pnpm patch` files for `@tsdotnet/queue`, `collection-base`, `compare`, `exceptions` — adds `.js` extensions to relative `.d.ts` imports for `moduleResolution: "node16"` compatibility
- Added Claude Code Docker config example to README
- Added Claude Code configuration instructions (project-scoped `.mcp.json`) to setup guide and README
- Added Kokoro quick-start guide to README — Docker pull, env vars, `/voice` panel, and voice table
- Added troubleshooting entry for multiple instances competing for the same bot token

## Changed

- Restored `@tsdotnet/queue` dependency — replaces hand-rolled `SimpleQueue<T>` inline class; uses `Queue<T>` directly (no shims) thanks to pnpm patches
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

## Fixed

- Fixed `session_start` never calling `setActiveSession` — per-session queues were created but never activated in production
- Fixed `close_session` not resetting active session when closing the currently active session
- Fixed `removeSessionQueue` leaking `_messageOwnership` entries for closed sessions
- Fixed `set_reaction` ignoring `temporary` flag — added explicit `temporary` boolean parameter so reactions auto-revert without requiring `restore_emoji` or `timeout_seconds`
- Fixed confirm/choose buttons staying forever after timeout when user sends a text message (#27)
