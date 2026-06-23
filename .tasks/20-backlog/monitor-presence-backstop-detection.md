---
Created: 2026-06-10
Status: backlog
Priority: medium
Source: 2026-06-10 — decision A resolution; deferred from 7.10.0
---

# TMCP Monitor Presence / Backstop Detection

## Context

7.10.0 decision A locked: "loud `service down` + monitor-robustness = the answer" for monitor liveness at the agent level. TMCP-side presence/backstop detection is explicitly deferred — do NOT build in 7.10.0.

## Problem

When an agent's monitor drops (network disconnect, SSE stream closed, activity file gone), the agent misses kicks. The 5-min re-kick (§5-a) only helps if the agent is alive and re-connects. A permanently stranded agent with a dropped monitor and pending queue content will wait forever.

## Proposed Scope

TMCP detects a stale/dead monitor (no SSE client alive, activity file untouched past N min) and takes one of:
- Alert the governor (S-IM message to session's owner)
- Expose a `/session/liveness` endpoint for governors to poll
- Emit a `service_message` that the agent would see on reconnect

Exact recovery action TBD with operator.

## Dependencies

- §5-a (5-min re-kick) must ship first — backstop only needed after re-kick fails
- Monitor robustness skill changes (Curator sign-off in progress)

## Deferred Until

Post 7.10.0. Pull forward if monitor drops cause observable coordination failures.
