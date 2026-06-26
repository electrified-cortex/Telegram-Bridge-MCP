# 10-3029 — subscription-close fail-hard: agent monitor must exit on close (MONITOR_EXIT)

**Re-attempt.** Prior worker impl (branch `worker/10-3029-subscription-close-fail-hard`, commit `79ab7bd1` "emit MONITOR_EXIT on SSE stream before unexpected close") FAILED the Overseer gate last session — 2 issues below. Operator priority 2026-06-26 ("shutdown but it didn't actually shut down" maps to this).

**Base:** dev (== master == `dcf6ca9d`, v7.17.0). The preserved worktree is STALE/divergent (dev +4, branch +9). **Cut a FRESH worktree from current dev**; use `79ab7bd1` only as a reference for the already-done SSE-emit part.

## Problem
On unexpected subscription close / shutdown, the agent's monitor (watcher process) does not reliably exit — it keeps running ("shut down but didn't shut down"). The `MONITOR_EXIT` signal must propagate so BOTH transport monitors (SSE + file-watch) exit cleanly.

## Fix scope (the 2 gate-failed issues + retain happy path)
1. **CRITICAL — activity-file MONITOR_EXIT propagation:** writing `MONITOR_EXIT` to the activity file does NOT reach the file-watch monitor because `monitor.sh` is mtime-only (never reads content). Fix so the file-watch `monitor.sh` actually detects `MONITOR_EXIT` and exits. Pick the clean approach (monitor.sh reads/acts on content, OR the writer guarantees a detectable signal) and justify it.
2. **HIGH — SSE catch-block cleanup:** `notifySseSubscriber`'s catch (error path) is missing the `MONITOR_EXIT` emit + the `unregisterSseMonitor` call. On an error-path close, emit `MONITOR_EXIT` + unregister.
3. **Retain:** the happy-path SSE `MONITOR_EXIT` emit (from `79ab7bd1`).

## Acceptance criteria (binary)
- [ ] AC1: On unexpected SSE subscription close — BOTH normal AND error/catch path — `MONITOR_EXIT` is emitted on the SSE stream AND `unregisterSseMonitor` is called. Tested both paths.
- [ ] AC2: On session/subscription close, the activity-file path propagates `MONITOR_EXIT` such that the file-watch `monitor.sh` exits — not just an mtime bump it ignores. Tested.
- [ ] AC3: `monitor.sh` (file-watch) exits cleanly on `MONITOR_EXIT` — behavioral test per the 10-0016 harness pattern (CI-clean, vendored fixture if needed).
- [ ] AC4: No regression — full `pnpm test` green + lint clean.
- [ ] AC5: No new user-facing "kick" terminology (kick→notify in progress); no pod terms; harness-agnostic strings.

## Overseer review
- Reviewer: Overseer (SID 2, governor). Date: 2026-06-26. Verdict: PASS — cleared for foreman.
- Review type: adversarial spec gate.
- Checked: ACs binary/testable; scope = the 2 gate-failed issues + retain happy path; bounded; base = current dev (cut fresh, stale worktree flagged); AC5 adds the kick→notify guard (lesson from v7.17.0).
- Not checked: implementation correctness — post-impl PR gate (Overseer adversarial review before any push).
- Delegation: worker implements → foreman verifies ACs → Overseer adversarial gate → operator merges. PUSH-GATED.

## Verification

- **Foreman AC verification:** 2026-06-26 — all 5 ACs PASS
  - AC1: `notifySseSubscriber` catch block emits `MONITOR_EXIT` + calls `unregisterSseMonitor(sid)` — confirmed in `src/sse-endpoint.ts`. 5 total MONITOR_EXIT emit sites (4 in `attachSseRoute` + 1 catch path). Emit before unregister — correct order.
  - AC2: `file-state.ts` `scheduleRetry` exhaustion writes `MONITOR_EXIT reason=subscription_closed_unexpectedly action=re-arm` via `writeFile` (overwrite, not append) — atomic; `monitor.sh` reads content on mtime change, exits 0 on `MONITOR_EXIT*` prefix.
  - AC3: `tools/test/monitor-exit-signal.sh` — 6/6 behavioral tests pass (CI-clean). Tests: normal notify, MONITOR_EXIT prefix exit, non-MONITOR content no-exit, file-absent no-exit, mtime-only-false-negative-gone, heartbeat-independent.
  - AC4: 3927/3927 tests pass, lint clean.
  - AC5: No new "kick" terminology. `monitor.sh` header updated to `notify/closed`. `SUBSCRIPTION_CLOSED_UNEXPECTEDLY` side-channel removed entirely (~45 lines, 3 exports).
- **Overseer adversarial gate:** PASS — 2026-06-26. Verdict: SAFE-TO-PUSH. Checked: 5 MONITOR_EXIT sites (correct order), file-state.ts atomic overwrite, monitor.sh content-check, AC3 CI-clean test, harness-agnostic, scope-clean.
- **Squash commit:** `90c7f82` on `dev` (2026-06-26)
- **Worker branch:** `worker/10-3029-monitor-exit-fix` (session `0cf69bf3`, commit `58cd6fc1`)
