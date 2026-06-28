---
created: 2026-06-20
status: backlog
priority: 30
source: epic 10-3020, audit finding 7 (agent abd67ab1210375674)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Optimization
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
epic: 10-3020
note: optional — only warranted if peekCategories shows up in profiling hot path
---

# 10-3024 — Optimize `peekCategories` (O(N) Drain-Re-enqueue)

## Background

Audit finding 7 (LOW / optional): `peekCategories` in `src/temporal-queue.ts:184–193`
uses `[...this._queue.consumer()]` — a **destructive iterator** that dequeues
all items, then re-enqueues them to restore state. This is O(N) per call with
two full traversals. It is called on every dequeue cycle and every
`hasPendingUserContent` check (which fires on inbound events, re-notify timer,
debounce release).

At current queue sizes (typically <10 items) this is inconsequential. This task
should only be worked if profiling identifies `peekCategories` in a hot path
during high-throughput operation.

## Proposed Fix

Maintain a parallel `Map<string, number>` category counter in `TemporalQueue`
that is updated incrementally on enqueue/dequeue — O(1) per operation, O(1) read.
`peekCategories` becomes a simple counter read.

## Steps

1. Branch from `dev`: `opt/peek-categories-counter`
2. Add `_categoryCount: Map<string, number>` to `TemporalQueue`
3. Increment on `enqueue`, decrement on `dequeue/consumer`
4. Replace `peekCategories` drain-re-enqueue logic with counter read
5. `pnpm build` clean
6. `pnpm test` passes (add test for counter accuracy if not covered)
7. Stage PR
8. Do NOT merge

## Acceptance Criteria

- [ ] `peekCategories` returns correct results after enqueue/dequeue operations
- [ ] No drain-re-enqueue pattern in `peekCategories`
- [ ] `pnpm build` clean
- [ ] `pnpm test` passes
- [ ] PR staged

## Scope boundary

- `TemporalQueue` only; no other queue implementations

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-20
- Verdict: PASS (bounded optimization, audit-identified — defer execution unless profiling confirms hot path)
