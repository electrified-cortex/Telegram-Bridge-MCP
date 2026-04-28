---
id: 15-0838
title: Curator shutdown — pre-shutdown metrics report from event log
priority: 15
status: draft
type: feature
delegation: any
needs: 15-0832 (event-log reporting tool)
---

# Curator shutdown — pre-shutdown metrics report

Before Curator runs its graceful shutdown procedure, generate and surface a session-scope metrics report derived from the bridge event log (`data/events.ndjson`).

## Why

Operator wants a per-session retrospective: how often did each agent compact, what fraction of the session was spent in compaction, were there outliers. Today the data exists in `events.ndjson` but nothing surfaces it. Adding this to shutdown turns the event log from "audit trail" into "session debrief".

## Acceptance criteria

1. New step in Curator's shutdown procedure (between "drain pending" and "session/close"): invoke the event-log reporting tool from `15-0832` for the current session window and produce a report.
2. Report contents (MVP):
   - Session window: start ts → shutdown ts.
   - Per agent (Curator / Overseer / Workers / any other actor seen in the log):
     - Compaction count.
     - Average compaction duration (paired `compacting`/`compacted` events via `run_id`).
     - Longest compaction.
     - Total time in compaction.
     - % of session time spent compacting.
   - Orphaned events: any `compacting` without a matching `compacted` (e.g. agent died mid-compact) noted explicitly.
3. Persistence:
   - Report saved to `logs/session/YYYYMM/DD/HHmmss/compaction-report.md` (or whatever the canonical session-log directory pattern is). One file per shutdown.
   - Same content surfaced to operator via the Curator handoff message (link or inline summary).
4. Failure tolerance: if the reporting tool is missing, broken, or the event log is empty, shutdown continues normally; the report step logs a warning and skips. Shutdown must never be blocked by a broken report.

## Out of scope

- Real-time dashboards. This is a single-shot report at shutdown only.
- Cross-session aggregation (multi-day trends). Handle in a separate report tool if needed later.

## Notes

- Discovered 2026-04-25 during operator's smoke test of the v7.2.0 `/event` endpoint. Operator wants the event log to feed an actual debrief, not just be a hidden audit file.
- Should leverage `15-0832` directly — that task ships the data layer; this task wires it into Curator's shutdown lifecycle.

## Completion

Completed by Worker 1 (SID 4) on 2026-04-26.

Added Step 6 (compaction metrics report) to the `graceful-shutdown` skill in `electrified-cortex`. Curator runs `node "<tmcp-root>/scripts/event-report.mjs" --format text` after all Workers/Overseer close, saves output to `logs/session/<YYYYMM>/<DD>/<HHmmss (UTC)>/compaction-report.md`. Failure-tolerant (script error → warning file + handoff note; never blocks shutdown). Report path included in handoff.md `## State`. Old Steps 6–8 renumbered to 7–9 across spec.md, uncompressed.md, and SKILL.md. Pre-existing diagram bugs corrected. Three code-review iterations; all blocking findings resolved.

Branch: `15-0838` in `electrified-cortex` repo. Commit: `38ebef2`.
