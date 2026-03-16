# [Unreleased]

## Added

- Added `TwoLaneQueue<T>` class — generic two-lane priority queue extracted from message-store, backed by `@tsdotnet/queue`
- Added `session-queue` module — per-session queues with message ownership tracking and inbound routing (targeted via reply-to/callback/reaction, ambiguous via broadcast)
- `session_start` now creates a per-session queue alongside the session
- `close_session` now removes the per-session queue on closure
- `list_sessions` tool — lists all active sessions (SID, name, creation time) and indicates the active session; no auth required
- `dequeue_update` is now session-aware — reads from session queue when a session is active, falls back to global queue
- Added cross-session outbound forwarding — bot messages from one session appear in other sessions' queues
- Added `routing-mode` module — configurable routing for ambiguous messages (load_balance default, cascade/governor stubs for Phase 4)
- Added `.npmrc` with `node-linker=hoisted` — flattens `node_modules` for reliable type resolution across transitive deps
- Added `pnpm patch` files for `@tsdotnet/queue`, `collection-base`, `compare`, `exceptions` — adds `.js` extensions to relative `.d.ts` imports for `moduleResolution: "node16"` compatibility

## Changed

- Restored `@tsdotnet/queue` dependency — replaces hand-rolled `SimpleQueue<T>` inline class; uses `Queue<T>` directly (no shims) thanks to pnpm patches
- Refactored `message-store` to delegate queue operations to `TwoLaneQueue<T>` — inbound events are also routed to per-session queues via `routeToSession`
- Ambiguous inbound messages now use load-balance routing (first idle session) instead of broadcast when multiple sessions are active
- Fixed lint errors in `close_session` — removed unnecessary `async` and type assertions

- Added session manager with incrementing SIDs and 6-digit PINs (crypto.randomInt)
- Added `SESSION_AUTH_SCHEMA` and `checkAuth()` for tool-level session authentication
- Added `close_session` tool with auth validation
- `session_start` now creates a session and returns `{ sid, pin, sessions_active }`
- Added optional `name` parameter to `session_start` for topic prefixing
- Added `sid` field to `TimelineEvent` — outbound messages tagged with active session ID
- Added active session context (`setActiveSession`/`getActiveSession`) for tool-call scoping

## Fixed

- Fixed `session_start` never calling `setActiveSession` — per-session queues were created but never activated in production
- Fixed `close_session` not resetting active session when closing the currently active session
- Fixed `removeSessionQueue` leaking `_messageOwnership` entries for closed sessions
- Fixed `set_reaction` ignoring `temporary` flag — added explicit `temporary` boolean parameter so reactions auto-revert without requiring `restore_emoji` or `timeout_seconds`
- Fixed confirm/choose buttons staying forever after timeout when user sends a text message (#27)

## Changed

- Improved `/voice` panel empty-state hint to mention built-in fallback and link to Kokoro setup
- Replaced VS Code-specific language with client-agnostic terms across README, LOOP-PROMPT, docs, tool descriptions, and pairing wizard output

## Added

- Added Claude Code Docker config example to README
- Added Claude Code configuration instructions (project-scoped `.mcp.json`) to setup guide and README
- Added Kokoro quick-start guide to README — Docker pull, env vars, `/voice` panel, and voice table
- Added troubleshooting entry for multiple instances competing for the same bot token
