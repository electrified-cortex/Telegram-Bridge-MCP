---
id: "50-0867"
title: "Consumer hook setup guidance — Telegram loop guard + compaction notifications"
type: task
priority: 50
status: queued
created: 2026-05-04
repo: Telegram MCP
delegation: Worker
depends_on: []
---

# Consumer hook setup guidance — loop guard + compaction notifications

## Background

Operator (2026-05-04): TMCP consumers (other Claude Code projects /
agents) need clear documentation on how to wire up the hook patterns
this fleet has converged on:

1. **Telegram loop guard** — hook-side mechanism preventing the
   "agent goes silent in dequeue, system thinks it's stuck" pattern.
2. **Compaction notifications** — hook-driven service event that
   fires `agent_event kind: compacting/compacted` so peers + operator
   know when an agent loses context.

Today both patterns exist in the in-house consumer fleet but are
poorly documented for outside consumers. Anyone integrating TMCP
into a new project has to reverse-engineer them from this repo.

## Goal

Author a consumer-facing guide that lets a fresh integrator stand
up the same hook-driven loop guard + compaction notifications in
their own Claude Code project in under 30 minutes.

## Deliverable

`docs/consumer-hooks.md` (or similar) covering:

### 1. Loop guard

- What problem it solves (silent dequeue blocks → agent appears stuck).
- Hook trigger point (PreToolUse on dequeue? PostToolUse? both?).
- Reference implementation (PowerShell + bash variants).
- Configuration knobs (timeouts, max consecutive blocks).
- Failure modes when not installed.

### 2. Compaction notifications

- What `agent_event` looks like (`kind: compacting`, `kind: compacted`).
- Which hook fires it (PreCompact? Stop? both?).
- Reference implementation pulling session token from env var,
  posting via TMCP `action(type: 'event/emit', ...)` or whatever the
  current API surface is.
- How peers consume it (`dequeue` returns `service_message` events
  with the right `event_type`).
- Reference example: in-house Curator's session-lifecycle skill
  triggers on these events.

### 3. Setup checklist

- Step-by-step: clone, install hooks, wire env vars, verify smoke
  test.
- Common pitfalls (PS5.1 vs PS7+, hook permission allowlist drift,
  token plumbing).
- How to test: send a sample tool call, observe the event in
  another session's dequeue.

## Acceptance criteria

- A Curator or Worker reading the doc end-to-end can install both
  hooks in a fresh project in under 30 min.
- Doc references canonical hook scripts in the consumer agents repo
  (don't duplicate the code — link to source files in this repo or
  the agents repo).
- Smoke test instructions are concrete (exact commands, expected
  output).
- Doc passes spec-audit if treated as a spec (or markdown-hygiene
  if treated as docs).

## Out of scope

- Implementing or modifying the hooks themselves (they exist; this
  task documents them).
- Permission allowlist patterns (separate concern).
- The Curator-specific session-lifecycle skill (cross-reference, but
  don't replicate).

## Dispatch

Worker. Sonnet for the writing (judgment); Haiku for the smoke-test
verification pass.

## Bailout

Hard cap 3 hours. 15-min progress heartbeats to Curator. If the hooks
turn out to live in multiple inconsistent places across the fleet,
surface — pick one canonical source and document that, don't try to
unify in this task.

## Related

- `agents/curator/hooks/` (fleet hooks reference)
- `agents/worker/hooks/`
- `agents/overseer/hooks/`
- Curator skill `session-lifecycle` (consumes the events)
- 50-0865 + 50-0866 (sibling postmortem-driven tasks)

## Completion

- **Branch:** `50-0867` in `Telegram MCP`
- **Commit:** `fbaee00e`
- **Deliverable:** `docs/consumer-hooks.md` — 205-line consumer guide covering loop guard (Stop hook), compaction notifications (PreCompact + PostCompact), setup checklist with 6 steps, 4 common pitfalls, and See Also links to existing docs.
- **Reference implementations used:** `.agents/hooks/telegram-loop-guard.ps1`, `.agents/hooks/telegram-event.ps1`, `.claude/hooks/telegram-loop-guard.sh`
