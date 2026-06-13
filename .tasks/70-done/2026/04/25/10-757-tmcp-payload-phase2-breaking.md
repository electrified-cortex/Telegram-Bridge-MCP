---
id: "10-757"
title: "TMCP payload reduction Phase 2 — breaking (~445 tokens/session)"
priority: 15
status: draft
created: 2026-04-24
repo: Telegram MCP
---

# TMCP payload reduction Phase 2 — breaking (~445 tokens/session)

## Problem

The highest-impact redundant fields in TMCP are breaking changes: `empty: true` and `timed_out: true` in `dequeue` responses, `split`/`split_count` in `send(text)` and `send(audio)`, and `timed_out: false` in interactive responses (`ask`, `choose`, `confirm`). These fields waste ~445 tokens/session. Every agent's dequeue loop currently depends on `if (result.empty)` / `if (result.timed_out)` checks — removing them without a migration path would break all agents simultaneously.

## Goal

Remove Phase 2 breaking fields behind a `response_format: "compact"` flag, allowing agents to migrate incrementally before the flag becomes the default.

## Fields to remove (under compact flag)

From `dequeue`:
- `empty: true` — the only dequeue field suppressed under compact; inferrable from the caller's use of `max_wait: 0` (instant poll context); `timed_out: true` is always emitted and is NOT suppressed under compact

From `send(text)` and `send(audio)`:
- `split: true` — inferred from `message_ids.length > 1`
- `split_count` — inferred from `message_ids.length`

From interactive responses (`ask`, `choose`, `confirm`):
- `timed_out: false` — callers infer non-timeout from presence of response fields (`text`, `value`, `confirmed`)
- `voice: true` from `send(ask)` — inferrable from call context

From `send(checklist)` update path:
- `updated: true` — already covered in Phase 1 if not shipped before Phase 2

## Acceptance criteria

- `response_format: "compact"` flag implemented and accepted by `dequeue`, `send`, and interactive handlers
- under the compact flag: `empty: true` is absent from dequeue instant-poll responses; `timed_out: true` is always present (not suppressed); all other listed fields are absent
- all agent dequeue loop patterns updated to infer empty from field absence (compact) or `empty: true` (default); `timed_out` is always present and never needs inference
- integration tests updated to cover both default and compact response shapes
- migration guide documents the loop pattern change with before/after examples

## Don'ts

- do not remove `empty: true` from dequeue without the `response_format: "compact"` migration flag in place first — breaking all agents simultaneously is not acceptable; `timed_out: true` is always emitted and must never be suppressed
- do not deploy Phase 2 to production until every agent consuming dequeue has been updated and verified
- do not merge Phase 2 into the default response shape until the compact flag has been running in all agents for at least one session cycle
- do not fold Phase 2 into Phase 1 work — keep the PRs separate so rollback is clean

## Source

- task: 10-0517 (TMCP output compression audit)
- findings: `audit/payload-audit.md` on branch `10-0517` of the TMCP repo

## Completion

Branch: `10-757`

Implemented `response_format: "compact"` flag across `dequeue`, `send`, `ask`, `choose`, `confirm`, and `send_new_checklist`. Compact mode omits: `empty: true` from dequeue instant-poll; `split`/`split_count` from send text/audio multi-chunk; `timed_out: false` and `voice: true` from interactive responses; `updated: true` from checklist update. `timed_out: true` on dequeue timeout is always emitted (Curator ruling — not inferrable from call context alone).

Also fixed a latent bug: `ask` command responses now emit `args: null` instead of dropping the field entirely when no args are present (`undefined` was silently dropped by `JSON.stringify`).

All 2665 tests pass. Build and lint clean.

## Verification

**Verdict:** APPROVED
**Date:** 2026-04-24
**Criteria:** 5/5 passed
**Evidence:** `response_format: "compact"` parameter confirmed in diffs for all 6 handlers (dequeue, send, ask, choose, confirm, send_new_checklist); compact suppression of all listed fields confirmed; `timed_out: true` always emitted unconditionally; 2665/2665 tests pass covering both default and compact shapes; `docs/help/guide.md` updated with compact-mode drain pattern and before/after code block; `docs/agent-setup.md` updated with compact mode reference and link to migration guide; `skills/telegram-mcp-dequeue-loop/SKILL.md` updated with Compact Mode section and before/after loop examples; `docs/compact-mode-migration.md` created with full field-suppression table and before/after code examples; `changelog/unreleased.md` updated with `response_format: "compact"` entry.
