# TMCP: Bridge advertises correct host (eliminate host-rewrite footgun)

Source: operator-reported via S-IM, 2026-06-12
Filed: 2026-06-12

## Summary

Current state: TMCP bridge advertises `0.0.0.0` in the SSE command, requiring agents
to manually rewrite the host before arming their SSE monitor (container: `bridge`,
host pod: `127.0.0.1`). This rewrite is a footgun — easy to miss, causes silent SSE failure.

Suggestion: Have the bridge detect and advertise the *correct* host in the first place,
so the `activity/listen` response already contains the right address and no client-side
rewrite is needed at all.

## Why

- Eliminates the rewrite step from the telegram-participation skill entirely
- Kills the footgun at the source — not a band-aid
- Aligns with operator directive: eliminate friction at the source rather than adding workarounds

## Investigation scope (TMCP codebase)

1. Where does `activity/listen` construct the SSE command URL? (src/ in Telegram-Bridge-MCP)
2. Is the advertised host configurable via env var? (e.g. BRIDGE_ADVERTISE_HOST)
3. If not, can we add an env var defaulting to the container hostname?
4. What's the right default for host pods vs container pods?

## Context

- Env-rewrite workaround documented in telegram-participation/SKILL.md R5
- Bridge v7.11.0 already staged (SSE registration fix) — this would be a follow-on
- Operator flagged as "worth investigating tomorrow"
