# [Unreleased]

## Added

- `dist/launcher.js` — stdio-to-HTTP bridge that auto-starts the Streamable HTTP server if none is running, then bridges stdin/stdout to it. Lets stdio-only hosts share a single server instance.

## Breaking Changes

- **Identity token redesign** — all tools now accept `token: number` (single integer) instead of `identity: [sid, pin]` (array tuple). See `changelog/2026-04-03_v5.0.0.md`.

## Security

- `list_sessions` now requires a valid auth token — unauthenticated callers receive an auth error instead of an empty or partial session list. (#15-251)
- Auth failure responses now use a single generic message (`"Invalid token"`) for both SID-not-found and wrong-PIN cases, eliminating the SID/PIN oracle that allowed session enumeration. (#15-251)

## Fixed

- `dequeue_update`: `timeout` parameter is now **optional** (was `.default(300)`) — omitting it uses the per-session default configured via `set_dequeue_default` (server fallback: 300 s). The parameter is also **capped at 300 s** via schema; values above 300 s are rejected at the schema level. For waits longer than 300 s, call `set_dequeue_default` to raise the session default and omit `timeout`. (#10-249)
- `dequeue_update`: internal `setTimeout` call is defensively clamped to 2,000,000,000 ms to prevent Node.js timer overflow when very large session-default values reach the wait loop. (#10-250)
- `set_dequeue_default`: timeout value is now capped at 3600 s (1 hour) via schema validation, preventing runaway wait durations. (#10-250)

## Changed

- Documentation restructured to recommend Streamable HTTP as the primary transport; stdio demoted to collapsible fallback section in README and setup guide.
- Docker documentation updated with HTTP-mode example and pairing note.
