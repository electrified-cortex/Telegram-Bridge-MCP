# 10-1927 — TMCP monitor: migrate to pod-style `monitor.sh` pattern

Priority: 10 (high — affects Curator's wake mechanism)
Classification: Curator-only
Status: Draft

## Background

The Curator's TMCP wake monitor (`b2f8cx05d` — "curator TMCP activity-file kick") is currently configured to call the HTTP DQ endpoint as part of its kick behavior, surfacing kicks as `<task-notification>` events to the Curator. Operator flagged this 2026-05-13 as feeling wrong shape: monitor stdout is conflating "signal that something happened" with "now go dequeue."

Meanwhile the pod architecture (task-engine `.foreman-pod/`, `.worker-pod/`, new `.overseer-pod/`) standardized on `monitor.sh` per box, sourced from `task-engine/.foreman-pod/outbox/monitor.sh`. The current pod-side pattern:

- Watches `<box>/.signal` for mtime change
- Emits `new message` (or `<prefix>: new message` when `--prefix` is passed)
- Emits `timeout` on inactivity timeout
- Supports `--single`, `--timeout`, `--prefix` flags
- Self-locates; no abs-path leak; caller controls prefix for multiplexing

## What to figure out

How to introduce the pod-style `monitor.sh` pattern into TMCP's Curator wake mechanism. Specifically:

1. **Where does the Curator's wake actually originate inside TMCP?** Identify the activity-file watcher service that currently fires `b2f8cx05d`-style kicks.
2. **What does "calls to HTTP DQ" actually do today?** Trace the path from file-change → HTTP DQ call → `<task-notification>` emission. Confirm the architectural gap.
3. **Does the pod-style `monitor.sh` belong inside TMCP or alongside it?** Options:
   - Replace the TMCP-internal watcher with a `monitor.sh` invocation that the Curator's pod owns.
   - Adopt the pod's `.signal` file convention inside TMCP's activity-file emission path.
   - Hybrid: TMCP emits, pod-side `monitor.sh` reads.
4. **What's the migration cost?** Existing TMCP watcher logic, downstream consumers, profile/load coupling.

## Acceptance criteria

- Findings document at `tasks/10-drafts/curator-only/15-NNNN-tmcp-monitor-findings.md` covering:
  - Current path (file → activity-file watcher → HTTP DQ → `<task-notification>`).
  - Proposed migration (which option, why).
  - Migration risk (what breaks, who else consumes the path).
- A follow-up implementation task filed if the spike is positive.

## Notes

- Pod-side `monitor.sh` lives at `task-engine/.foreman-pod/{inbox,outbox}/monitor.sh` (and `.worker-pod/` copies). Single canonical source.
- `--prefix` flag added 2026-05-13; would let the Curator's wake distinguish "TMCP activity" from "pod-message" kicks once the Curator has multiple monitors armed.
- Curator-only because it's the Curator's own infrastructure; no Worker should touch this.
- Operator authority: 2026-05-13 voice ("file curator-only task to follow up").

## Won't-do (for this spike)

- Don't migrate yet. Spike + recommend first.
- Don't change Overseer/Foreman/Worker monitors — they're already on the new pattern.
