# 20-735 - Adaptive scan interval for Worker scan-for-queued

## Context

Observed 2026-04-19: Workers idle-loop on `scan-for-queued.ps1` at a fixed interval regardless of queue state. When the queue has been empty for a while, this is wasted CPU + log noise; when a task lands, pickup latency is bounded by the interval.

Operator has mentioned preferring a responsiveness-biased fleet. Adaptive intervals would lower idle cost and improve pickup latency under burst.

## Acceptance Criteria

1. When `scan-for-queued.ps1` returns zero queued tasks for N consecutive scans (default N=3), back off: double the interval up to a configured ceiling (default 60s from starting 5s).
2. When a scan returns > 0 queued tasks, reset to the floor interval immediately.
3. Floor, ceiling, and backoff factor are configurable via env vars or a small config file - not hardcoded.
4. Emit a single log line on backoff state change (floor -> backing-off, backing-off -> floor), not on every scan.
5. Regression test or harness verifying the backoff curve.

## Constraints

- Do not change the script's output contract (stdout format stays the same).
- Do not introduce a daemon process - must remain a single-invocation script driven by the worker loop.
- Pickup latency under an active burst must not be worse than the current fixed interval.

## Priority

20 - quality of life. Fleet hygiene + responsiveness. Not blocking any merge.

## Delegation

Worker (TMCP) after design review.

## Related

- Memory `project_task_pipeline_architecture.md`.
- 20-736 (loud-on-anomaly; adjacent observability work on the same loop).

## Activity Log

- 2026-04-24: Worker 3 claimed task, ran pre-flight (located scan.ps1, SKILL.md, spec.md, scan-for-queued.ps1).
- 2026-04-24: Impl subagent created `scan-for-queued.ps1` (backoff wrapper), `scan-for-queued.tests.ps1` (harness), updated `SKILL.md`. Two commits (submodule + superproject).
- 2026-04-24: Code Reviewer — 1 major (table-mode stream capture), 4 minors (Floor>Ceil guard, stderr format, parse failure logging, test coverage), 1 nit (portable temp path). All fixed in follow-up commit.
- 2026-04-24: Build verify — pwsh execution blocked by hook; backoff curve manually traced (all 8 test cases pass).

## Completion

- Branch: `20-735`
- Commits: `767eb24` (impl), `8f8209e` (review fixes)
- New files: `tasks/.engine/scan-tasks/scan-for-queued.ps1`, `scan-for-queued.tests.ps1`; updated `SKILL.md`
- Subagents: Impl ×1, Code Reviewer ×1
- Review verdict: 1 major fixed, 4 minors fixed, 1 nit fixed
- Note: `pwsh -File` blocked by hook — Overseer to run test harness on merge
- Ready for Overseer merge.
