# [Unreleased]

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
