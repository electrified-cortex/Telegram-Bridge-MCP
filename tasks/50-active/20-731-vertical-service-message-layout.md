# 20-731 - Service message layout: go vertical for multi-line events

## Context

Operator observed 2026-04-19 (msg 38372) that service messages like "closed session Overseer (SID2), this cannot be undone" crowd onto one line and are hard to parse at a glance on Telegram. Voice: "should be more vertical."

The `service_message` rendering path currently concatenates title + detail + hint on a single line (or minimal line breaks), which works for short notices but fails readability for multi-attribute events like session closes, approvals, ticket issuance, and shutdown warnings.

## Acceptance Criteria

1. Identify the service-message composer(s) in the bot (event formatter path, probably under `src/services/` or `src/bot/`).
2. For events that carry more than one attribute (session ID, name, ticket, reason, etc.), render each attribute on its own line with a bold label.
3. Short single-attribute events keep their current inline form.
4. Add or update unit tests that snapshot the new layout for at least `session_close`, `pending_approval`, `shutdown_warn`.
5. `pnpm test` green.

## Constraints

- Do not rewrite the event_type taxonomy. Layout only.
- Telegram Markdown must render on iOS, Android, and Desktop clients - no HTML-only tricks.
- Keep messages under Telegram's 4096-char limit even for maxed-out details.

## Priority

20 - quality of life. Not blocking, but first-contact agents and operator both benefit.

## Delegation

Worker (TMCP).

## Related

- 15-713 (first-DM compression service message - same surface).
