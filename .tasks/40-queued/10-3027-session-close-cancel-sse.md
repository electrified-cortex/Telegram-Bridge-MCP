---
created: 2026-06-22
status: queued
priority: 26
source: Curator dogfood session — operator approved 2026-06-22
target-branch: dev/7.13.0
---

# Bug: session/close does not send `data: cancelled` to active SSE monitor

**Operator approved:** 2026-06-22 ("yes! fix it")
**Source:** Overseer session-end investigation, 2026-06-22
**Symptom:** After `action(type: 'session/close')`, the SSE monitor (sse-monitor.sh) receives
a connection drop (EOF) instead of a clean `data: cancelled` event, causing it to enter
reconnect backoff rather than exiting cleanly.

## Root Cause

`src/session-teardown.ts` → `closeSessionById(sid)` calls `clearActivityFile(sid)`, which
**intentionally preserves the SSE gate entry** when `entry.sseConnected === true`:

```ts
if (entry.sseConnected) {
  // keep the shared gate entry alive — drop only file registration
  entry.filePath = null;
  ...
}
```

`cancelSseConnection(sid)` (the only path that sends `data: cancelled`) is in
`src/tools/activity/cancel-listen.ts` and is **never called from session-teardown**.

## Expected Behavior

`session/close` should flush `data: cancelled` to any active SSE listener for that session
before tearing down, so the SSE monitor exits cleanly (exit 0) rather than reconnecting.

## Proposed Fix

In `closeSessionById` (or `clearActivityFile`), call `cancelSseConnection(sid)` when
`sseConnected` is true, BEFORE clearing/preserving the gate entry. This sends `data: cancelled`
on the stream, sse-monitor.sh exits cleanly, and the gate entry can then be torn down fully.

Also: update the finalize-session.md template comment that says session/close
"automatically handles activity/listen/cancel" — currently false.

## Files

- `src/session-teardown.ts` — add `cancelSseConnection(sid)` call
- `src/tools/activity/file-state.ts` — `clearActivityFile`: tear down gate entry after cancel
- `src/tools/activity/cancel-listen.ts` — reference implementation for cancel path

## Acceptance Criteria

- [ ] After `session/close`, any active SSE monitor receives `data: cancelled` and exits 0
- [ ] `sse-monitor.sh` task completes cleanly (no reconnect backoff) after session close
- [ ] Existing tests pass; new test: session close with active SSE fires cancelSseConnection
- [ ] finalize-session.md comment updated to reflect actual behavior

## Delegation

TMCP foreman — `dev/7.13.0` branch.
