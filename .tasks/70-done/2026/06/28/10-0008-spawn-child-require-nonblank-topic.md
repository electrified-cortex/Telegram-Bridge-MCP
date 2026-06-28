---
created: 2026-06-15
status: draft
priority: 10
source: Directive (Telegram msgs 75003–75024)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Bug
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
---

# Task: TMCP — session/spawn-child MUST require a non-blank topic (fail-fast)

**ID**: spawn-child-require-topic
**Date**: 2026-06-15
**Priority**: High
**Status**: Draft
**Origin**: Telegram msgs 75003–75024

## Background

`session/spawn-child` currently accepts a spawn with **no `topic`** (or a blank/empty topic). The child is then created with a default topic (the parent's name, e.g. "Curator"), producing **zero-topic threads**. The topic is set **at spawn time and is IMMUTABLE** thereafter — a post-spawn `profile/topic` call returns:

`CAPABILITY_DENIED: "Sub-sessions cannot change their topic — it was set at spawn time and is immutable."`

So a topic-less spawn is **unrecoverable** — the only remedy is revoke + re-spawn. Per requirements: sub-sessions MUST HAVE A TOPIC — zero-topic threads are a serious issue, and agents repeatedly omit the param.

## Problem

The silent topic-less spawn combined with topic immutability makes this a footgun. Nothing enforces the topic at creation, so malformed (topic-less) threads get created and can never be corrected in place.

## Proposed fix

`session/spawn-child` should **reject/error at spawn time** if `topic` is missing **or** blank/empty — fail fast, do not create the session. The error should name the required `topic` parameter so the caller fixes it immediately.

## Design rationale

- Spawn must fail immediately if topic is missing or blank
- Empty/whitespace topics are not acceptable values
- Topic is an identity attribute set at spawn time, not a rename operation

## Acceptance Criteria

- [ ] `session/spawn-child` with `topic` missing → error response (not 2xx), error text references `topic`
- [ ] `session/spawn-child` with `topic: ""` (empty string) → same error
- [ ] `session/spawn-child` with `topic: "   "` (whitespace-only) → same error
- [ ] `session/spawn-child` with valid non-blank `topic` → still creates child session successfully
- [ ] Unit tests cover all four cases above
- [ ] `tsc --noEmit` passes
- [ ] All pre-existing tests pass

## Scope

- Modify validation in `session/spawn-child` handler only (trim + reject empty topic)
- Error response shape: consistent with existing TMCP error format
- Does NOT change topic immutability behavior (that is existing, correct behavior)
- Does NOT change any other `session/*` handlers

## Delegation

Executor: Worker / Reviewer: Curator

## Notes

- Filed at Draft tier; promoted to `40-queued` after triage.
- Curator-filed as a bug in TMCP.

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-20
- Verdict: PASS — ACs added (4 validation cases + tests + build). Scope: single handler, validation-only. Delegation correct (Worker + Curator review). Fix is one-liner (trim + check). No open questions. Operator-directed priority 10. PASS.


## Verification

- Verifier: a17bc713375468490
- Date: 2026-06-28
- Verdict: APPROVED
- AC1 (missing topic → error): CONFIRMED — validation block fires, error code MISSING_PARAM, message contains "topic"
- AC2 (empty topic "" → error): CONFIRMED — `!""` = true, test "topic-empty" passes
- AC3 (whitespace topic → error): CONFIRMED — trim check, test "topic-whitespace" passes
- AC4 (valid topic → child created): CONFIRMED — "pref-rank ①" format, tests pass
- AC5 (unit tests cover all cases): CONFIRMED — 4 new validation tests + existing tests updated
- AC6 (tsc --noEmit clean): CONFIRMED — test-plan.md: 0 errors
- AC7 (all pre-existing tests pass): CONFIRMED — 4011/4011 pass
- Engineering gate: PASSED (test-results.md + test-plan.md present with real output)
- Note: branch shares base commits with dev (wave-2 work); squash diff is 7 files in-scope only
