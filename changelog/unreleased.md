# [Unreleased]

## Added

- `dist/launcher.js` — stdio-to-HTTP bridge that auto-starts the Streamable HTTP server if none is running, then bridges stdin/stdout to it. Lets stdio-only hosts share a single server instance.

## Breaking Changes

- **Identity token redesign** — all tools now accept `token: number` (single integer) instead of `identity: [sid, pin]` (array tuple). See `changelog/2026-04-03_v5.0.0.md`.

## Changed

- Documentation restructured to recommend Streamable HTTP as the primary transport; stdio demoted to collapsible fallback section in README and setup guide.
- Docker documentation updated with HTTP-mode example and pairing note.
