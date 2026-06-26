# /shutdown is a no-op when the chat is empty (everybody left)

**Source:** operator 2026-06-26 (voice 79863). **Type:** bug. **Status:** draft — needs investigation/repro before gating (operator: "don't overchase").

## Problem
When all participants have left the chat and the operator issues `/shutdown`, the Telegram MCP (bridge server) does NOT actually shut down — `/shutdown` does nothing. Operator: "the times I see this never, never working is if everybody's left the chat and I go to do shutdown — it does nothing."

## Repro (operator)
1. All participants leave the chat (empty roster / no active sessions).
2. Operator runs `/shutdown`.
3. Expected: bridge server shuts down.
4. Actual: nothing happens — server keeps running.

(Operator also noted a more general "I do shutdown and it doesn't shut down the server" — the empty-chat case is the reliable repro.)

## Where to look (NOT yet investigated — capture only)
- `src/built-in-commands.ts` — the `/shutdown` handler (~L334, L657–661) and its guard (~L210: "Prevents a lingering `/shutdown` from killing a freshly-started server").
- `src/shutdown.ts` — `elegantShutdown`, `clearCommandsOnShutdown`.
- Hypothesis: a guard/condition that, in the empty-chat state, blocks or silently drops `/shutdown`. Candidates: the pending-message safety guard (shutdown has a `force` param to bypass it), a session/roster presence check, or the freshly-started-server guard mis-firing.

## Relationship to 10-3029
DISTINCT from 10-3029 (agent-monitor `MONITOR_EXIT` propagation). THIS is the BRIDGE's `/shutdown` command no-op'ing. May share a root cause (something blocking shutdown) — TBD on investigation.

## Acceptance criteria (binary)
- [ ] AC1: `/shutdown` reliably shuts down the bridge server when the chat is EMPTY (no participants / empty roster) — the documented repro now shuts down (was a no-op).
- [ ] AC2: Root cause documented — exactly which guard/condition was blocking `/shutdown` in the empty state.
- [ ] AC3: The legitimate guard is PRESERVED — a stale/lingering `/shutdown` still does NOT kill a freshly-started server (don't regress the L210 protection). Distinguish "operator's deliberate /shutdown when empty" from "stale /shutdown after restart."
- [ ] AC4: Regression test for the empty-chat `/shutdown` path (or a documented manual verification if the path isn't unit-testable).
- [ ] AC5: No regression — full `pnpm test` green + lint clean. Harness-agnostic; no new `kick` terminology.

## Overseer gate (2026-06-26)
- Reviewer: Overseer (SID 2, governor). Verdict: PASS — cleared for foreman (operator-approved tonight).
- Checked: AC1 binary/testable (empty-chat /shutdown works); scope = find + fix the blocking guard WITHOUT breaking the freshly-started-server protection; root-cause required; no-regression AC.
- Not checked: implementation correctness — post-impl PR gate.
- Delegation: foreman → worker (root-cause + fix) → Overseer adversarial gate → operator merges. PUSH-GATED. Base: current dev (c47a20cd).

## Verification

- **Foreman AC verification:** 2026-06-26 — all 5 ACs PASS
  - AC1: `handleIfBuiltIn(/shutdown)` fires `elegantShutdown("operator")` with `activeSessionCount() === 0`. Regression test `AC1-regression:` added to `built-in-commands.test.ts`.
  - AC2: Root cause documented in commit message + `session-teardown.ts` comment — `stopPoller()` on last-session-close killed the Telegram poll loop.
  - AC3: `STALE_COMMAND_GRACE_SECONDS` guard in `built-in-commands.ts` untouched (orthogonal mechanism). Stale `/shutdown` still ignored after fresh boot.
  - AC4: Regression tests in `built-in-commands.test.ts`, `session-teardown.test.ts`, `close.test.ts`.
  - AC5: 3929/3929 tests pass, lint clean. No new `kick` terminology. Harness-agnostic.
- **Overseer adversarial gate:** PASS — 2026-06-26. Verdict: SAFE-TO-PUSH. Root cause correct; fix minimal; AC3 guard preserved; regression tests genuine; scope clean.
- **Squash commit:** `fafc9f34` on `dev` (2026-06-26)
- **Worker branch:** `worker/shutdown-when-empty` (session `d09bb54b`, commit `3dc02101`)
