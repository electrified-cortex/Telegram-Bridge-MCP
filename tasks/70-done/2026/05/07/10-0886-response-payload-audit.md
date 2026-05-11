---
id: "10-0886"
title: "AUDIT: Tool response payload bloat — unnecessary fields and always-true booleans"
type: task
priority: 30
status: queued
created: 2026-05-06
filed-by: Worker
delegation: Worker
target_repo: telegram-bridge-mcp
target_branch: feat/10-0885-response-payload-audit
---

# Tool Response Payload Audit

## Background

Many TMCP tool responses include fields that carry no actionable information for
the caller — always-true booleans, empty objects, echo-back of inputs, redundant
wrapper keys. These inflate every tool call response with token bloat that agents
don't need.

The audit question for each field: **"Is this necessary to be in the response?"**
If the absence of an error already implies success, a `success: true` field is noise.

## Scope

All tool response shapes in `src/tools/**/*.ts` (non-test files).
See `audit/response-payload.md` for full findings.

## Exclusions

- Error/fault responses — these are necessary
- `hint:` fields — welcome, but content should be reviewed separately
- `dequeue` updates array shape — that is the core payload, not noise

## Key Findings Summary

### High Impact (remove immediately)

- **Empty returns** — `send/dm`, `message/delete`, `reminder/cancel` return `{}`.
  Pure noise; error-only pattern would suffice.
- **Always-true booleans** — `sent: true`, `split: true`, `ok: true`, `approved: true`,
  `loaded: true`, `saved: true`, `rolled: true`, `routed: true`. All inferrable from
  absence of error.
- **`dequeue` `empty: true`** — caller passed `max_wait: 0` explicitly; they already
  know it's an instant poll. Already omitted in compact mode but present in default.

### Medium Impact

- **Echo-back fields** — `show-typing` echoes `timeout_seconds` (caller set it);
  `session/close` echoes `reason` (caller triggered it).
- **Redundant wrapper keys** — `animation/status` wraps result in `{session: {...}}`
  or `{sessions: [...]}` — the wrapper key adds no semantic value.
- **`progress/update` `updated: true`** — inferred from no error.

### Low Impact

- **`activity/get` `registered` bool** — awkward when null/absent would suffice for
  "not registered" state.
- **`message/pin` inconsistency** — returns `{}` or `{unpinned: true}` depending on
  path; should be uniform.

## Estimated Savings

~15–20% response payload reduction across typical multi-tool workflows.

## Acceptance Criteria

- [ ] Audit report reviewed by Curator
- [ ] Implementation scope agreed (which fields to remove, which to keep)
- [ ] Changes implemented in a follow-up task (10-0886)
- [ ] No tool behavior changes — response shape only

## Branch

`feat/10-0885-response-payload-audit` (audit doc only, no code changes)

## Rollback

Audit only — no code changes. Nothing to roll back.

## Closure

**Closed:** 2026-05-07
**Status:** Superseded — findings applied in 10-0887 (squash-merged to master as PR #168, TMCP v7.4.1). Findings summary preserved in task frontmatter above.
