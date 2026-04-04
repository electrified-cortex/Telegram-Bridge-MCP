# [Unreleased]

## Added

- `dist/launcher.js` — stdio-to-HTTP bridge that auto-starts the Streamable HTTP server if none is running, then bridges stdin/stdout to it. Lets stdio-only hosts share a single server instance.

## Breaking Changes

- **Identity token redesign** — all tools now accept `token: number` (single integer) instead of `identity: [sid, pin]` (array tuple). See `changelog/2026-04-03_v5.0.0.md`.

## Security

- `list_sessions` now requires a valid auth token — unauthenticated callers receive an auth error instead of an empty or partial session list. (#15-251)
- Auth failure responses now use a single generic message (`"Invalid token"`) for both SID-not-found and wrong-PIN cases, eliminating the SID/PIN oracle that allowed session enumeration. (#15-251)

## Changed

- Documentation restructured to recommend Streamable HTTP as the primary transport; stdio demoted to collapsible fallback section in README and setup guide.
- Docker documentation updated with HTTP-mode example and pairing note.
