# [Unreleased]

## Added

- `dist/launcher.js` — stdio-to-HTTP bridge that auto-starts the Streamable HTTP server if none is running, then bridges stdin/stdout to it. Lets stdio-only hosts share a single server instance.
- `set_reminder`: new `trigger: "startup"` option — fires the reminder as an event in the next `dequeue_update` call on `session_start` (fresh or reconnect). Non-recurring startup reminders self-delete after firing. Startup reminders are preserved by `save_profile` / `load_profile`; `delay_seconds` is optional and ignored for this trigger type.

## Breaking Changes

- **Identity token redesign** — all tools now accept `token: number` (single integer) instead of `identity: [sid, pin]` (array tuple). See `changelog/2026-04-03_v5.0.0.md`.

## Changed

- Documentation restructured to recommend Streamable HTTP as the primary transport; stdio demoted to collapsible fallback section in README and setup guide.
- Docker documentation updated with HTTP-mode example and pairing note.
