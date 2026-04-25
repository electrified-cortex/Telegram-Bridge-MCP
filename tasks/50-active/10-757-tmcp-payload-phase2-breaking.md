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
- `empty: true` — inferred from `pending: 0` and absence of `updates`
- `timed_out: true` — inferred from absence of `updates` after a blocking wait

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
- under the compact flag all listed fields are absent from responses
- all agent dequeue loop patterns updated to infer empty/timeout from field absence rather than discriminator fields
- integration tests updated to cover both default and compact response shapes
- migration guide documents the loop pattern change with before/after examples

## Don'ts

- do not remove `empty: true` or `timed_out: true` from dequeue without the `response_format: "compact"` migration flag in place first — breaking all agents simultaneously is not acceptable
- do not deploy Phase 2 to production until every agent consuming dequeue has been updated and verified
- do not merge Phase 2 into the default response shape until the compact flag has been running in all agents for at least one session cycle
- do not fold Phase 2 into Phase 1 work — keep the PRs separate so rollback is clean

## Source

- task: 10-0517 (TMCP output compression audit)
- findings: `audit/payload-audit.md` on branch `10-0517` of the TMCP repo
