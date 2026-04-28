---
id: 15-0832
title: Event-log reporting tool — frequency, duration, summaries on demand
priority: 15
status: draft
type: feature
delegation: any
needs: 10-0831 (event log) shipped first
---

# Event-log reporting tool

Reads the bridge event log (NDJSON from 10-0831) and answers operator questions about agent-lifecycle metrics.

## Use case

Operator asks Curator: "given these metrics, where are we at right now? How can we improve?"

Curator runs the reporting tool, gets a digest, summarizes for operator. Tool is the data layer; Curator is the interpretation layer.

## Output shape (MVP)

A single command (script or MCP action) returns:

```text
Window: last <N> hours (default 24)

Per agent:
  Curator:    compactions=2  avg_duration=4.2s  longest=7s    last=12m ago
  Overseer:   compactions=4  avg_duration=3.1s  longest=5s    last=3h ago
  Worker 1:   compactions=8  avg_duration=2.8s  longest=4s    last=18m ago

Other event kinds (counts only):
  startup: 4   shutdown_warn: 2   shutdown_complete: 2
```

## Inputs (CLI flags)

- `--window <hours>` — default 24.
- `--agent <name>` — filter to one actor.
- `--kind <name>` — filter to one event kind.
- `--format json|text` — text default.

## Implementation

- Read `data/events.ndjson` (or wherever 10-0831 lands the log).
- Filter by window/agent/kind.
- Group by `actor_sid` + `kind`. Pair `*` start kinds with their `*_complete` counterparts on `details.run_id`.
- Emit the digest.

Single-file Bash or PowerShell script. Could be a TMCP CLI tool under `scripts/` OR an MCP action `action(type: "events/report")` if MCP is preferred. Operator preference unstated — recommend script first (zero-context invokable from Curator) with MCP wrapper later if useful.

## Acceptance

- Tool runs from any agent's working directory (resolves event log path from bridge config).
- Window filter works.
- Pairing logic correctly computes duration for `compacting` / `compaction_complete` etc.
- **Graceful degradation when complete-events are missing.** Some hooks may emit only the start event (no PostCompact wired). Start-only events still count toward frequency; duration becomes `N/A`. Output must be honest about coverage — flag agents with start-only data so the operator knows duration is unmeasured for them.
- Output is parsable from a Curator dispatch (so Curator can summarize for operator).

## Don'ts

- Do NOT introduce a database. NDJSON tail-scan is sufficient at MVP scale.
- Do NOT block on log rotation — tool must handle a missing-or-empty log gracefully (return "no events yet").
- Do NOT couple to MCP. Plain shell tool is the canonical form.

## Related

- 10-0831 — event endpoint + log format. Must ship first.
- Curator usage pattern: dispatch this script from a fresh agent, parse output, present to operator.

## Branch

`15-0832` off `dev`.

## Completion

Implemented `scripts/event-report.mjs` — single-file ESM Node.js script reading `data/events.ndjson`.

Files changed:
- `scripts/event-report.mjs` (new) — full implementation with window/agent/kind filtering, generic `PAIRED_KINDS` pairing, text + JSON output
- `src/built-in-commands.test.ts` — pre-existing lint fix (arrow functions → block bodies)
- `src/tools/callback-edge-cases.test.ts` — pre-existing lint fix (unused `afterEach` import removed)

Two-pass code review completed; both blockers resolved. Build: tsc clean, pnpm lint/test pass.
