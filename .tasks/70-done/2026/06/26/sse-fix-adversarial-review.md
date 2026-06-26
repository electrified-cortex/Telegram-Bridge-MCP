# SSE Wake-Reliability Fix — Adversarial Review

**Files:** `src/sse-endpoint.ts`, `src/sse-endpoint.test.ts`
**Verdict:** ship-with-fixes
**Reviewer date:** 2026-06-11

---

## Verdict

`ship-with-fixes`. No blockers were confirmed. The highest-verified severity is **major** on one finding (EC-2-KEEPALIVE-UNTESTED), but the production code itself has no crash or data-loss path. The functional gaps are test coverage and two hygiene defects (keepalive guard, dequeueDefault restore). Fix the must-fix items before committing; the should-fix items can be in the same PR or a fast-follow.

---

## Must Fix

1. **EC-2-KEEPALIVE-UNTESTED** — The keepalive `setInterval` (lines 107-115) has zero test coverage. The 30s tick, `clearInterval` on `req.on("close")`, and the write-failure catch branch are all trust-based. Use `vi.useFakeTimers()` to cover at minimum: (a) tick fires and writes `: keepalive`; (b) timer is cleared on close; (c) write failure cleans up `_connections` and gate. (Severity: major)

2. **KEEPALIVE-WRITE-NO-WRITABLEENDED-GUARD / F-2 / F7** — These three findings converge on the same code: the keepalive `res.write` at line 109 has no `!res.writableEnded && !res.destroyed` guard. In Node.js, `res.write()` after `writableEnded` silently returns `false` rather than throwing, so the catch block never fires and the interval leaks until the TCP `close` event. The `req.on("close")` handler provides a backstop for the common path but not for half-open sockets. Mirror the guard from `src/index.ts` lines 213-217: add `if (!res.writableEnded && !res.destroyed)` before the `res.write` call, and `clearInterval` + cleanup in the else branch. (Severity: minor, but same PR as keepalive tests)

---

## Should Fix

3. **EC1-LIGHTWEIGHT-MISS** — `hasPendingUserContent` checks only `OPERATOR_MESSAGE_TYPES`; it returns `false` for `direct_message` and `callback` events even though `/dequeue` surfaces both. A reconnect with only DM/callback content pending will not trigger the EC-1 kick, and the 5-min re-notify timer also uses the same predicate so it will not re-fire either. Add `direct_message` to the checked set or introduce a separate `hasAnyPendingContent` predicate for the connect-kick path. (Severity: minor)

4. **EC-1-TEST-STATIC-ONLY** — The two EC-1 tests pre-seed the queue before the SSE connect. They do not exercise the actual race sequence: connect → dequeue-drain → disconnect → enqueue-during-gap → reconnect → assert immediate kick. Add that lifecycle integration test. (Severity: minor)

5. **F-5 / dequeueDefault restore removal** — Lines 127-129 restore `priorDefault` on SSE close. No caller depends on the snap-back; keeping 90s on close is the operator's stated intent and is harmless. Remove lines 127-129 and the now-unused `priorDefault` capture at line 117. (Severity: minor, safe simplification)

6. **F-3 / stale lockout on reconnect** — In sessions with both an activity-file AND SSE monitor, `unregisterSseMonitor` only clears `sseConnected` and leaves `notifyLockedUntil` intact. On reconnect the gate starts armed, so the first post-reconnect inbound is briefly suppressed (then re-evaluated via `releaseNotifyLockout`, not lost). Call `resetNotifyGateState(sid)` after `registerSseMonitor(sid)` on the reconnect path to give the fresh connection a clean gate. (Severity: minor; SSE+file overlap is rare but the fix is one line)

---

## Nits

- **EC1-GATE-BYPASS / F1** — Connect-kick bypasses `notifyIfAllowed`, leaving `notifyLockedUntil` null. A second inbound in the same tick can double-kick. Both code and docs explicitly call extra kicks harmless; the gate self-arms on the second event. Comment explaining the deliberate bypass is sufficient.
- **EC2-KEEPALIVE-NO-GUARD / F7** — Comment at line 106 claims to mirror `index.ts:213-218` but the guard expression is absent. Update the comment to match reality (or apply the guard per must-fix item 2).
- **EC1-CONNECT-KICK-ERROR-PATH-GATE-LEAK** — Early-return on kick write failure is safe only because `keepaliveTimer` is assigned after the kick block. Non-obvious ordering dependency; add a comment.
- **EC1-POST-CHECK-WINDOW-RESIDUAL** — `_connections.set(sid, res)` at line 84 precedes the `hasPendingUserContent` check, making the post-check window safe in Node's single-threaded model. An `await` inserted anywhere in lines 84-103 would silently break this. Add a comment explaining the invariant.
- **F-4** — `clearInterval(keepaliveTimer)` in `req.on("close")` is intentionally unconditional (clears this response's timer regardless of which connection is current). The existing comment only documents the identity guard below it; note the unconditional intent.
- **F-6** — Negative EC-1 test uses a 250 ms time-bound assertion with no positive anchor. Add an assertion that `lines` is empty (it always is, since `collectSseLines` drops comment lines), and optionally document that `: connected` comment is intentionally invisible to the helper.
- **COLLECT-SSE-LINES-COMMENT-LINES-INVISIBLE** — `collectSseLines` filters to `data:` prefix; `: keepalive` and `: connected` are silently dropped. Add a raw-line helper or an optional predicate parameter so keepalive tests can assert on comment lines.
- **EC-1-GATE-LOCKOUT-INTERACTION-UNTESTED** — No test covers: file+SSE session with armed `pendingReNotifyHandle` + connect-time kick → assert at most one data-line emitted. Low-priority (double-kick is harmless per design) but documents the known benign behavior.
- **CANCEL-SSE-KEEPALIVE-LEAK** — `cancelSseConnection` cannot reach `keepaliveTimer` (closure variable). After `res.end()`, the interval fires up to once more, then `req.on("close")` cleans it up. Normal disconnect path self-heals. Fix (store timer in `_connections` map) is desirable but not urgent.

---

## Recommended Tests

1. `vi.useFakeTimers()` — advance 30s, assert `: keepalive` line emitted on raw stream.
2. Open SSE, advance 30s, abort connection, advance another 30s, assert no further writes (timer cleared by `req.on("close")`).
3. Simulate keepalive `res.write` throwing → assert `_connections` does not contain sid and gate entry is removed.
4. Full EC-1 lifecycle: connect → dequeue-drain → disconnect → enqueue-during-gap → reconnect → assert `data: kick` without additional enqueue.
5. `hasPendingUserContent` + `direct_message`-only queue → returns false; confirm desired vs actual semantics and fix or document.
6. File+SSE session with stale lockout on reconnect → assert `resetNotifyGateState` was called (or verify gate starts clean after connect).

---

## Bottom Line

The EC-1 and EC-2 fixes are structurally sound and close the original missed-wake race. No finding confirmed as a blocker; the most severe confirmed finding is missing keepalive test coverage (major) and the keepalive write lacking the `writableEnded` guard already present in `index.ts` (minor). The dequeueDefault restore on close is a safe dead-code removal the operator already intended. Production correctness is not in question — the PR is safe to ship after adding keepalive tests and the `writableEnded` guard. All remaining items are minor hygiene or documentation nits that can land in a fast-follow.


---
_Archived 2026-06-26 by audit — shipped (v7.13–7.18) or promoted into epics 10-3001/10-3017._

**Signed-off-by:** Claude Opus 4.8 — closure verified via task-board audit (subagent-assisted) against `src/` + `git log` on 2026-06-26.
