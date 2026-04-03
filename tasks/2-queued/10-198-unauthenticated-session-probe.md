---
Created: 2026-04-03
Status: Draft
Priority: 10
Source: Operator directive (voice, 21948)
Repo: electricessence/Telegram-Bridge-MCP
Branch target: dev
Related: 10-196, 15-197
---

# 10-198: Unauthenticated Session Probe

## Context

Currently, `list_sessions` requires a valid `[SID, PIN]` identity. Agents
starting up (or restarting after a bounce) cannot check which sessions exist
without already having valid credentials.

The operator identified this as a key blocker for smart reconnection: agents
should be able to probe the bridge to see if their session is still alive
before attempting to rejoin.

Operator quote: "They should be able to probe to see which sessions are active.
There's nothing wrong with that. It doesn't need a pin. They say session list
and it'll say... if they don't provide a pin, then they actually just get the
session IDs that are active."

## Goal

Allow `list_sessions` (or a new `probe_sessions` tool) to be called without
authentication, returning only the active session IDs — no names, no state,
no details.

## Proposed Behavior

### Unauthenticated Call
```json
// Request (no identity)
{ "tool": "list_sessions" }

// Response — IDs only
{
  "sessions": [1, 2, 3, 4, 6]
}
```

### Authenticated Call (existing behavior preserved)
```json
// Request (with valid identity)
{ "tool": "list_sessions", "identity": [1, 692554] }

// Response — full details (unchanged)
{
  "sessions": [
    { "sid": 1, "name": "Curator", "state": "active", ... },
    ...
  ]
}
```

## Security Considerations

- **Information leak:** Returning only SIDs reveals how many sessions are active
  but nothing about their names or roles. Acceptable for a local MCP bridge.
- **Enumeration risk:** An attacker could see how many agents are running. This
  is low risk since the bridge runs on localhost (stdio transport).
- **No PIN exposure:** The probe NEVER returns PINs, names, or session details.

## Implementation

1. Modify `list_sessions` tool handler to check if `identity` is provided
2. If no identity: return `{ sessions: [sid1, sid2, ...] }`
3. If identity provided: existing behavior (full session list)
4. No new tool registration needed — just a behavior change

## Acceptance Criteria

- [ ] `list_sessions` works without identity parameter
- [ ] Unauthenticated call returns only active SID numbers
- [ ] Authenticated call behavior unchanged
- [ ] No PINs, names, or details exposed in unauthenticated response
- [ ] Tests for both authenticated and unauthenticated paths

## Reversal Plan

Revert the identity-optional check. Require identity on all `list_sessions` calls
(existing behavior).
