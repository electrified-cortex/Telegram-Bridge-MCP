# 10-0895 — Activity-file kick still doesn't fire post-7.4.2 (RED ALERT)

**Priority**: 10 (STAT — operator's primary signal is broken)
**Status**: active (Curator working DIY)
**Type**: bug fix
**Target release**: 7.4.3
**Target branch**: release/7.4.3
**Tags**: bug, defect
**Created**: 2026-05-10 (operator confirmed via test)

## Context

PR #172 (commit fd47552d) merged for 10-0893 with the claim
"recordActivityTouch must not cancel pending kick timer." Source code in
`src/tools/activity/file-state.ts` lines 238-248 reflects the fix.
Compiled `dist/tools/activity/file-state.js` line 193 has the same fix
language. Bridge is running version 7.4.2 (after PR #173 bump).

**Symptom (confirmed 2026-05-10 22:20 local)**: Curator session SID 1
sat IDLE (no tool calls) from ~22:17:30 to ~22:20. Operator sent
multiple inbound messages during that window. File mtime
(`data/activity/abbc0b84a105ca0eaf1fc6a93f52b64e`) stayed frozen at
epoch 1778476626 (22:17:06 local). Kick debounce is 60000ms (default).
After 150s+ of true silence the kick should have fired. It did not.

PR #172 / 10-0893 was THOUGHT to fix this. It did not — either the fix
addressed only one of multiple bugs, or the fix has its own bug.

## Acceptance criteria

### AC1 — Identify the root cause

Trace the inbound path for a session that has an active activity file
registration:

1. inbound event → `resolveTargetSession` → `enqueueToSession`
   (`src/session-queue.ts:227`)
2. `enqueueToSession` calls `touchActivityFile(sid)` at line 235
3. `touchActivityFile` (`src/tools/activity/file-state.ts:285`) gates
   on `nudgeArmed` + `!inflightDequeue`, schedules timer if within
   debounce, fires `doTouch` when window elapses.
4. `doTouch` calls `appendNewline` to mutate the file.

Hypotheses to confirm/refute:
- `nudgeArmed` not being re-armed after the first kick (look at
  `setDequeueActive(false)` path)
- `inflightDequeue` stuck at true (catch/finally around dequeue handlers)
- Scheduled debounce timer fires but re-evaluation skips the kick
- `appendNewline` silently fails

### AC2 — Fix the root cause

Apply the minimum-edit fix on `release/7.4.3`. Add a focused regression
test that fails before the fix and passes after.

### AC3 — Manual verification

Restart the bridge, repeat the silent-window test:
1. Send a message from operator.
2. Wait > 60s with NO Curator tool calls.
3. Verify mtime of `data/activity/<file>` changes (epoch advances).

### AC4 — Test coverage

Add a unit test that simulates: registered activity file, inbound event,
no agent tool calls for > debounceMs → kick fires. Should fail against
current code (otherwise the test is wrong).

### AC5 — Update changelog

Add an entry to `changelog/unreleased.md` (or appropriate
`<date>_v7.4.3.md` per the release-flow cleanup discipline) describing
the second-order bug + fix.

## Non-goals

- The `stopped` HTTP event (10-0894) — separate ticket.
- Refactoring the activity-file state machine.

## Notes

- This is Curator-DIY per operator instruction ("First we MUST fix this
  issue even if you do it yourself"). Foreman is parallel-tasked on
  10-0894.
- Investigation evidence at: `notes/kick-still-broken-2026-05-10.md`
  (incomplete — Sonnet dispatch was stopped mid-investigation per
  operator redirection).
- Bridge restart required to test the fix — coordinate with operator.

## Cross-references

- 10-0893 (the "fixed" issue this re-opens)
- PR #172 (the incomplete fix)
- PR #173 (package.json version bump)
- Sibling: 10-0894 (stopped-event feature; foreman's ticket)
