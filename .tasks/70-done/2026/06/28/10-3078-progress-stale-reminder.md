---
title: "TMCP: Extend stale_after to progress bars (mirror of 10-3074)"
id: 10-3078
priority: HIGH
status: queued
category: Feature
filed: 2026-06-28
source: TG 81345
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# Extend stale_after to Progress Bars

## Context

10-3074 added `stale_after` to `send(type:'checklist')` — fires a reminder when a checklist
goes stale. The same mechanism should apply to progress bars: a stalled progress bar is
equally invisible to the operator.

The `stale-timer.ts` module (armStaleTimer / resetStaleTimer / clearStaleTimer) is already
live on dev. This task wires it into the progress bar path.

## Acceptance Criteria

1. [ ] `send(type:'progress')` accepts optional `stale_after` integer (seconds) — same semantics as checklist
2. [ ] When `stale_after` elapses without a `progress/update` and `percent < 100`, fires a reminder event (`progress_stale`) into the owning session's dequeue queue
3. [ ] `progress/update` resets the stale timer (same as `checklist/update` → `resetStaleTimer`)
4. [ ] Timer cleared when `percent === 100` (terminal state for progress bars)
5. [ ] No timer armed when `stale_after` not set (opt-in, no default)
6. [ ] Unit test: stale timer fires after threshold with `vi.useFakeTimers()`, suppressed at percent 100
7. [ ] Integration test: `handleSendProgress` + `handleUpdateProgress` with `stale_after` → reminder appears in dequeue; update resets; 100% clears
8. [ ] `tsc --noEmit` clean, all pre-existing tests pass

## Implementation Notes

- Reuse `stale-timer.ts` directly — `armStaleTimer(message_id, sid, stale_after * 1000, title, [])` where title = progress title
- `clearStaleTimer` on `percent === 100` in the update handler
- `resetStaleTimer` on every other `progress/update`
- Reminder event type: `progress_stale` (parallel to `checklist_stale`)
- Add `deliverProgressStaleEvent` to `session-queue.ts` (same shape as `deliverChecklistStaleEvent`)

## Scope

- `src/tools/progress/` (send + update handlers) — wire stale_after param
- `src/session-queue.ts` — add `deliverProgressStaleEvent`
- `src/tools/send.ts` — expose `stale_after` on progress path
- `src/tools/progress/*.test.ts` — add stale timer tests
- No other files

## Gate review

- reviewer: gate
- date: 2026-06-28
- verdict: PASS
- review type: adversarial gate
- checked: ACs 1-8 all binary+testable, scope bounded to progress path + session-queue, delegation complete (Worker, sonnet-class, dev), stale-timer.ts already live (low implementation risk), terminal state clearly defined (percent === 100), no open questions
- note: mirror of proven 10-3074 pattern; implementation notes are sufficient to constrain the worker
<!-- overseer-gate: PASS 2026-06-28 -->

## Verification

- **verdict**: APPROVED
- **verifier**: Overseer (push-gate)
- **date**: 2026-06-28
- **worker_commit**: 6d8212c2
- **squash_commit**: af1606b9
- **tests**: 4179/4179 (171 test files — confirmed by foreman on branch HEAD 6d8212c2)
- **revision**: Bug 1 (BLOCKER) — `resetStaleTimer` title param fixed to `string | undefined`, `entry.title = title ?? entry.title` prevents overwrite with empty string. Bug 2 — schedule-trigger branch in save.ts adds `...(r.id ? { id: r.id } : {})` like other branches.
- **LLM pre-pass**: unavailable (gateway timeout) — flagged per protocol; Overseer gate substituted
- **ACs**: 1-8 all PASS
