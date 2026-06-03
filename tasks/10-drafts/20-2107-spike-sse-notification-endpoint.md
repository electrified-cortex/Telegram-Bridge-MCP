---
id: 20-2107
title: "Spike: SSE notification endpoint for TMCP — replace file-based activity monitor"
Created: 2026-06-02
Status: draft
Priority: medium
type: spike
target_version: 7.9.0-spike
Source: operator direction 2026-06-02
Delegation: Worker
related: [20-0002]
---

# Spike: SSE notification endpoint for TMCP

## What this is

A **spike** running in parallel with simple-im spike 20-0002. Same goal, different system.
TMCP currently uses a file-based activity monitor (an activity file + monitor.sh) to notify
agents when their dequeue queue has new events. This spike proves whether an SSE HTTP endpoint
can replace that file entirely — cleaner, scalable to remote agents, no filesystem dependency.

Worker proves whether it works. Documents findings. No production code required.

## Context

**Current TMCP notification chain:**
1. TMCP writes to the activity file on new event.
2. Agent runs `monitor.sh <activity_file>` as a Monitor tool command (persistent).
3. monitor.sh detects mtime change, emits a line, Monitor fires.
4. Agent calls dequeue.

**Proposed replacement:**
1. TMCP exposes `GET /sse/sessions/{token}` (or similar) — an SSE stream per session.
2. TMCP fires `data: kick` on the stream when a new event is enqueued for that session.
3. Agent runs `curl -N -H "Authorization: Bearer {token}" http://tmcp/sse/sessions/{token}`
   as the Monitor tool command.
4. Monitor fires on `data: kick`. Agent calls dequeue.

**Why this matters:** the file-based monitor only works on the same machine (local filesystem).
An SSE endpoint works over HTTP — enabling remote agents, containerized agents, or agents
on different hosts to receive real-time notifications without shared filesystem access.

## Spike scope

This is a proof-of-concept. The worker:
1. Adds a **minimal** SSE endpoint to TMCP (server-sent events, one stream per session token).
2. Fires `data: kick` on that stream whenever a message is enqueued for the session.
3. Tests it with `curl -N` as the Monitor tool command.
4. Investigates the same durability questions as simple-im spike 20-0002.
5. Documents findings and gives a verdict.

**Minimal means:** no authentication redesign, no new persistence, no breaking changes to
existing behavior. The file-based activity monitor continues to work. SSE is additive.

## Implementation notes

- TMCP is a Node.js/TypeScript server (MCP-based). SSE in Node.js: use `res.writeHead(200, ...)`,
  `res.write("data: kick\n\n")`.
- The endpoint needs a session-token-to-SSE-connection map. Simple in-memory Map is sufficient
  for the spike (not durable across restarts — acceptable for a spike).
- Fire `data: kick` from the same code path that currently touches the activity file (or writes
  to the dequeue queue). One additional line alongside the existing mechanism.
- The endpoint URL and token verification approach is the worker's choice — document what was
  chosen and why.

## Worker tasks

1. **Add minimal SSE endpoint** to TMCP (e.g., `GET /sse` with token in Authorization header,
   or `GET /sse/{token}` in the path — worker decides). Must not break existing behavior.

2. **Wire the kick** — in the code path that enqueues a new event for a session, after writing
   to the existing dequeue queue (and activity file if still present), fire `data: kick` to any
   open SSE connection for that session token.

3. **Build TMCP** and test the SSE endpoint manually:
   ```
   # Open SSE stream (in one shell)
   curl -N -H "Authorization: Bearer {your_session_token}" http://localhost:{tmcp_port}/sse

   # Trigger a kick by sending a Telegram message to the session (in another shell/context)
   ```
   Observe whether `data: kick` appears in the curl output.

4. **Test with Monitor tool** — use the curl command above as the Monitor tool command.
   Send a message via Telegram that triggers a dequeue event. Observe Monitor notification.

5. **Durability tests** (same as simple-im spike D1-D3):
   - D1: What happens when the TMCP server restarts mid-stream? Does Monitor die silently?
   - D2: Does TMCP send a clean-close signal (final `data: session-closed` event, or just TCP close)?
   - D3: Test a reconnect wrapper loop — does Monitor handle it?

6. **Document findings** in `.temp/spike-sse-tmcp-result.md`:
   - Endpoint path chosen and rationale
   - Did curl + Monitor fire on kick? Yes/No + timing
   - Durability behavior documented
   - Is this viable as a full replacement for the file-based activity monitor?
   - Any TMCP-specific complications (auth, routing, MCP protocol overlap)?

## Acceptance criteria

- [ ] AC1: SSE endpoint added to TMCP; does not break existing behavior (existing tests still pass).
- [ ] AC2: `curl -N` against the endpoint receives `data: kick` when a new event is enqueued.
- [ ] AC3: Monitor tool fires on kick.
- [ ] AC4: Durability questions D1-D3 tested and documented.
- [ ] AC5: Result file at `.temp/spike-sse-tmcp-result.md` with findings.
- [ ] AC6: Worker verdict: viable replacement for file-based activity monitor, or not? With reason.

## Out of scope

- Production implementation (no version bump, no changelog)
- Authentication redesign
- Remote/cross-host deployment testing
- Performance benchmarking
- Removing the file-based activity monitor (this spike does not replace it)

## Comparison with simple-im spike

Simple-im (20-0002) already HAS the SSE endpoint — that spike proves the curl + Monitor
pattern works against a clean implementation. This TMCP spike ADDS the endpoint and proves
the same pattern works in an existing production-grade system with more moving parts.

The two spikes run simultaneously. If both prove viable, the output feeds directly into the
TMCP 7.9 epic (SSE migration of the activity file system).