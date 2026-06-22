---
title: TMCP — Asymmetric outbound drop after outage (recoverable via session refresh)
source: operator-reported, 2026-06-22
priority: medium
status: draft
type: finding / potential hardening
---

## Observed Behavior

After a service outage or disruption:
- **Inbound Telegram messages** continue to arrive correctly
- **SSE activity-file monitor** stays alive and fires on incoming
- **Outbound sends** via `mcp__telegram-bridge-mcp__send` return `{"message_id": ..., "split_count": ...}` (accepted by bridge) but messages are **NOT delivered** to the Telegram user

This is an **asymmetric failure**: the session appears live from the agent's perspective (no errors, message_ids returned) but outbound is silently broken.

## Recovery

`session/start` with `refresh: true` — restores outbound routing. The session token can be reused (`reused: true`). After refresh, outbound delivery works again.

Confirmed: operator-reported on 2026-06-22. Re-anchor fixed it immediately.

## Impact

Agent may operate believing it is communicating with the operator while actually sending nothing. Silent failure — no error surfaced. Could persist for a long time undetected.

## Potential Hardening

1. **Outbound health check**: After a send that returns a message_id, optionally verify delivery (e.g. by checking if the message appears in chat history or by a bridge-side delivery callback). If a series of sends succeed with message_ids but no operator response arrives for N minutes, surface a self-diagnostic prompt.

2. **Post-outage re-anchor protocol**: When recovering from a `server_gone` / connection disruption event, automatically call `session/start refresh:true` as part of the recovery sequence — don't assume the outbound path survived.

3. **Bridge-side delivery confirmation**: The bridge could track whether a sent message was accepted by the Telegram API vs. just queued internally, and surface a failure if Telegram API rejects or drops it.

## Related

- Session recovery: `telegram-participation` skill re-anchor steps
- S-IM used as reliable fallback channel during TG outbound failure (confirmed viable)
