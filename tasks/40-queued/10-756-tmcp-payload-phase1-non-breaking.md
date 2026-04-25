---
id: "10-756"
title: "TMCP payload reduction Phase 1 — non-breaking (~115 tokens/session)"
priority: 10
status: draft
created: 2026-04-24
repo: Telegram MCP
---

# TMCP payload reduction Phase 1 — non-breaking (~115 tokens/session)

## Problem

TMCP tool responses include ~30 redundant fields across `send`, `dequeue`, and `action` handlers. Phase 1 targets the fields that are safe to remove immediately: echoed inputs callers already know, `ok: true` confirmation flags, and informational fields that don't drive control flow. These waste ~115 tokens/session with zero benefit.

## Goal

Remove all non-breaking redundant fields identified in the 10-0517 audit. No callers consume these fields; removal is safe without a migration flag.

## Fields to remove

From `send` handlers:
- `audio: true` from `send(audio)` — echoed input
- `file_type` from `send(file)` — echoed input
- `target_sid` from `send(dm)` — echoed input
- `persistent` from `send(animation)` — echoed input
- `delivered: true` from `send(dm)` — no error means delivered
- `updated: true` from `send(checklist)` update path — no error means updated
- `_hint` from `send(audio)` — 20–50 token narrative, not machine-readable
- `length` from `send(append)` — informational only, no control-flow use

From `action` sub-paths:
- `ok: true` from `message/delete`, `message/pin`, `show-typing`, `acknowledge`
- `keyboard_cleared?` from `acknowledge`
- `scheduled: true` from `reminder/set`
- `cancelled: true` and echoed `id` from `reminder/cancel`
- `added`, `message_id`, `emoji`, `preset` from `react` (keep only `temporary?`)

## Acceptance criteria

- every field listed above is removed from the respective handler
- no existing caller behavior changes — none of these fields are consumed
- existing test suite passes with no modifications required
- token savings land at approximately 115 tokens/session as estimated in the audit

## Don'ts

- do not remove `split`, `split_count`, `empty: true`, or `timed_out` discriminators — those are Phase 2 (breaking)
- do not remove `message_id` from any handler — still needed for edits and reactions
- do not remove `text_message_id` from `send(audio)` — essential when caption overflows
- do not remove `info?` from `send(text)` — only emitted for table markdown warnings, useful signal
- do not remove `unpinned?: true` from `message/pin` — non-redundant conditional field

## Source

- task: 10-0517 (TMCP output compression audit)
- findings: `audit/payload-audit.md` on branch `10-0517` of the TMCP repo
