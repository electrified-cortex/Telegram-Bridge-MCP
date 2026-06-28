---
id: 10-event-local-sh-auto-url-discovery
title: "event.local.sh: auto-discover bridge URL instead of requiring manual env var"
Created: 2026-06-09
Status: backlog
Priority: 10
type: improvement
Source: operator voice 70497, 2026-06-09; backlog note
---

# event.local.sh: auto-discover bridge URL

## Problem

Every pod that uses a non-default bridge port (anything other than 3098) must manually
set `TELEGRAM_BRIDGE_HTTP_BASE` in compose.yaml. Forgetting it means lifecycle events
silently fire at the wrong bridge — a hard-to-diagnose failure.

## Operator's desired end state

`event.local.sh` should "just work" for any pod without per-pod configuration.

## Candidate approaches

1. **Read from local.mcp.json at hook time** — parse the MCP server URL, strip `/mcp`
   suffix to get the base. Works for any pod that has `local.mcp.json`. Downside:
   JSON parsing in bash (requires `jq` or fragile grep).

2. **Write bridge base URL to a well-known file on bridge start** — bridge writes
   `$POD_ROOT/.bridge-url` on startup; `event.local.sh` reads it. Clean separation,
   no JSON parsing. Requires TMCP change.

3. **Derive from TMCP env at hook time** — if TMCP exposes the HTTP base URL as an
   env var (e.g. `TMCP_HTTP_BASE`), pass it into the compose.yaml `environment` block
   once and event.local.sh reads it. Same as current approach but self-documenting.

4. **Keep manual but fail loudly** — use `${TELEGRAM_BRIDGE_HTTP_BASE:?must be set}` 
   (bash error-on-unset) rather than a silent wrong default. At least the failure is
   obvious immediately.

## Current decision

Keep manual env var configuration for now (option 3 / compose.yaml). File this as
backlog. Operator noted reading MCP on every event would be expensive.

## Acceptance criteria (future)

- [ ] A new pod with a non-standard port requires zero per-pod configuration in
      event.local.sh or compose.yaml to post lifecycle events to the correct bridge.
- [ ] Failure to configure results in a loud immediate error, not silent misfiring.
