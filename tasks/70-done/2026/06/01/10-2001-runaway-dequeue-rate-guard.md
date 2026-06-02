---
created: 2026-06-01
status: 10-drafts
priority: 10-2001
source: operator-call-2026-06-01 (post-incident)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
target_branch: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# 10-2001 — Runaway-dequeue rate guard (watch dequeue/min, flag, warn the agent)

## Context

On 2026-06-01 the Curator agent entered a tight dequeue/idle-poll loop and burned ~1M tokens before the operator happened to notice — it ran silently with no cost guard. The operator's directive: the bridge itself must watch how often a session dequeues, flag an excessive rate as "something is wrong," and message the looping agent to stop. This is a structural backstop so a stuck/looping agent is caught by the bridge, not by luck.

Today the existing `behavior-tracker.recordDequeue()` returns early on empty dequeues (`if (!hasUserMessage) return;`), so idle polls — the exact runaway pattern — are never counted. The guard must count *every* dequeue attempt.

## Objective

Add a per-session runaway-dequeue guard at the single choke point for all dequeues — `runDrainLoop()` in `src/tools/dequeue.ts` (both the MCP `dequeue` tool and the HTTP `/dequeue` endpoint call it). Count every dequeue *attempt* in a sliding 60-second window; when the rate exceeds a threshold, deliver a rate-limited warning service message to that session telling the agent it is looping and to stop.

## Acceptance Criteria

1. Every dequeue attempt is counted — including empty/`timed_out`/`max_wait:0` idle polls (NOT just batches containing user messages).
2. Counting uses a sliding window of 60s per session; entries older than the window are pruned.
3. When attempts-in-window ≥ threshold (default 20, a named tunable constant), a warning is delivered to that session via `deliverServiceMessage` with a distinct `eventType` (e.g. `behavior_runaway_dequeue`).
4. The warning is itself rate-limited (min 30s between warnings per session) so the guard cannot spam.
5. The warning text states the count, that it indicates a likely runaway loop, asks why the agent is dequeuing so often, and tells it to stop polling and do real work or wait for a genuine signal.
6. Normal low-rate dequeuing (a handful per minute, legitimate multi-message drains) does NOT trigger the warning — verify no false-positive on a burst that drains a real backlog then settles.
7. The guard never throws and never alters dequeue semantics or latency.
8. Per-session state is keyed by sid and cleaned up on session close (no unbounded growth); a test-reset export exists.
9. Unit tests cover: under-threshold (no warn), over-threshold (warn once), cooldown (no repeat within 30s), window pruning (old attempts drop off).
10. `tsc --noEmit` passes; `npm run build` succeeds.

## Proposed approach (reference — Curator drafted + typechecked this; Worker to verify, own, test, deploy)

In `src/tools/dequeue.ts`, near the other module-level trackers, add a sliding-window map and a `checkDequeueRate(sid, now)` helper; call it once near the top of `runDrainLoop` after the `session_closed` guard (so every attempt passes through it). Reference implementation:

```ts
const RATE_WINDOW_MS = 60_000;
const RATE_THRESHOLD = 20;            // attempts/window before flagging (tunable)
const RATE_WARN_COOLDOWN_MS = 30_000; // min gap between warnings (anti-spam)
const _dequeueAttempts = new Map<number, number[]>();
const _lastRateWarnAt = new Map<number, number>();

function checkDequeueRate(sid: number, now: number): void {
  if (sid <= 0) return;
  const cutoff = now - RATE_WINDOW_MS;
  const pruned = (_dequeueAttempts.get(sid) ?? []).filter(t => t >= cutoff);
  pruned.push(now);
  _dequeueAttempts.set(sid, pruned);
  if (pruned.length < RATE_THRESHOLD) return;
  const lastWarn = _lastRateWarnAt.get(sid) ?? 0;
  if (now - lastWarn < RATE_WARN_COOLDOWN_MS) return;
  _lastRateWarnAt.set(sid, now);
  deliverServiceMessage(sid,
    `RUNAWAY DEQUEUE: ${pruned.length} dequeue attempts in the last 60s — likely a stuck loop burning tokens. STOP looping; do real work or wait for a genuine signal, do not poll idly.`,
    "behavior_runaway_dequeue");
}
```
Wire cleanup into the session-close path that already calls `removeSession`/`removeSilenceState`. Worker should validate placement, add tests, and confirm `deliverServiceMessage` is the right delivery (vs envelope hint).

## Out of Scope

- Changing dequeue timeouts / long-poll semantics.
- Touching any other pod's bridge or container.
- A configurable-per-session threshold (constant tunable is enough for v1).

## Delegation

Executor: Worker
Reviewer: Curator

## Affected Files / Repos

- `electrified-cortex/Telegram-Bridge-MCP/src/tools/dequeue.ts` (guard + wiring)
- A unit test under the TMCP test suite for `checkDequeueRate` behavior.

## Blockers

None.

## Rollback

Not a governance path (no hook, no `.claude/`, no agent spec). Rollback = revert the `dequeue.ts` change. Deploy = `npm run build` + restart the bridge; LOCAL bridge only — do NOT bounce BT's separate container bridge.

## Notes

- Came from a real incident (Curator, 2026-06-01). Operator wants it.
- Curator drafted + typechecked a reference implementation but per role must not self-build/deploy bridge code — this task hands implementation, verification, and the careful local-only deploy to a Worker.
- Threshold (20/min) is a starting point; Worker may tune after observing real rates.
- IMPLEMENTATION STASH (worker-verified, awaiting review): `git stash apply b468ac7ac9c5655cbd8d505bb6e613718813fce1` — implements this task in `src/tools/dequeue.ts` + `dequeue.test.ts`. Verified: tsc --noEmit clean, npm run build ok, 106 tests pass (4 new). Pop to review / verify / deploy (local bridge only). NOT committed, NOT deployed.

## Overseer review
- reviewer: Overseer SID-3
- date: 2026-06-01
- verdict: PASS
- review type: adversarial dispatch
- checked: ACs binary (counts, thresholds, cooldown windows, build pass), scope bounded to dequeue.ts + test file (both confirmed exist), delegation explicit
- note: spec references git stash b468ac7ac9c5655cbd8d505bb6e613718813fce1 as pre-baked implementation — worker should verify/promote rather than re-implement; this is a documentation gap, not a blocker

## Verification

- **Verdict:** APPROVED
- **Date:** 2026-06-01
- **Verifier:** dispatched sub-agent (read-only)
- **Squash commit:** `e1cb110` on `dev`
- **Worker commit:** `3d6210ae` on `worker/10-2001-runaway-dequeue-rate-guard`
- **Test evidence:** 3275/3275 tests pass (142 files), tsc clean, build clean
- **All 10 ACs:** CONFIRMED — guard at runDrainLoop() choke point, 60s window, threshold 20, cooldown 30s, session teardown wired, test-reset export present, 4 unit tests covering all edge cases
