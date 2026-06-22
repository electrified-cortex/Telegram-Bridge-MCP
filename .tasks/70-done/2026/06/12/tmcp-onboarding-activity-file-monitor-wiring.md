---
created: 2026-05-05
status: queued
priority: 20
type: improvement
agent_type: Worker
repo: electrified-cortex/Telegram-Bridge-MCP
model_class: sonnet-class
reasoning_effort: medium
---

# Strengthen activity/file onboarding for Monitor-capable runtimes

## Problem

The `onboarding_loop_pattern` service message mentions activity files as an "augment" but language is too weak. Agents in Monitor-capable runtimes (Claude Code) don't automatically wire it up.

## Goal

Update onboarding language to be runtime-conditional:
- If runtime has Monitor/file-watcher → create activity file + start watcher background process → Monitor fires → `dequeue(max_wait: 0)`
- If runtime lacks Monitor (VS Code etc.) → skip gracefully, use standard long-poll

## Acceptance Criteria

1. `onboarding_loop_pattern` message updated with runtime-conditional guidance.
2. Concrete bash/PS example of mtime watcher provided (reuse `src/tools/activity/canonical-recipe.ts`).
3. Non-Monitor runtimes don't break or receive confusing guidance.
4. Verified in Claude Code: activity file created, Monitor fires on inbound message, dequeue called.

## Scope boundary

- `ONBOARDING_LOOP_PATTERN` message text only (and any directly related constants).
- Do not change `help('activity/file')` — that was already updated in 15-0899.
- Do not change the canonical recipe constant itself — reuse as-is.

## Related / partially superseded

Task **15-0899** (merged) published the canonical `Monitor` recipe as a shared constant and surfaced it from `session/start`, `session/reconnect`, and `help('activity/file')`. The concrete bash mtime-poll watcher example and `Monitor` parameter guidance are now in `docs/help/activity/file.md`.

**Remaining scope here:** runtime-conditional onboarding language in `ONBOARDING_LOOP_PATTERN` and Claude Code–specific auto-wiring guidance. The recipe constant (`src/tools/activity/canonical-recipe.ts`) can be reused.

## Overseer gate

**Reviewer:** Overseer  
**Date:** 2026-06-12  
**Verdict:** PASS

- ACs are binary and testable (4 ACs)
- Scope: `ONBOARDING_LOOP_PATTERN` text update only — well-bounded
- Delegation: Worker, sonnet-class — correct
- Partially superseded by 15-0899 but remaining scope is clear and documented
- `canonical-recipe.ts` provides the reuse anchor — no open design questions


## Verification

APPROVED 2026-06-12 — Verifier confirmed all 4 ACs: ONBOARDING_LOOP_PATTERN now runtime-conditional (Monitor/non-Monitor paths), canonical-recipe.ts created and reused inline, non-Monitor fallback clean, 6 new tests, 3443/3443 pass. Commit 02104683.

Sealed-By: foreman
