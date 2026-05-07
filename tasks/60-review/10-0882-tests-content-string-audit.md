---
id: "10-0882"
title: "Audit tests for content-string assertions (test logic, not copy)"
type: refactor
priority: 10
status: queued
created: 2026-05-05
updated: 2026-05-06
filed-by: Curator
delegation: Worker
target_repo: telegram-bridge-mcp
target_branch: release/7.4
---

## Update 2026-05-06 — release/7.4 CI blocker

Operator: "CI tests failing — most are content-string assertions. Get past the stupid removal of content checking, then we can merge release/7.4." This is now the merge gate for release/7.4. Bumped to P10. Target branch flipped to release/7.4 (was dev — release/7.4 is downstream of dev so the work needs to be there for PR #167 to go green).

The "no string-content tests" prohibition is now codified in `.agents/agents/worker/context/refresh.md` (commit b797e64) — Worker should follow that rule going forward AND retroactively scrub the existing test base.



# Test-content audit — drop assertions on copy, keep assertions on logic

## Operator framing (2026-05-05, msg 50388)

> "One thing I absolutely fucking hate is testing content in help tests. Like, what is this waste of brain power? This is terrible. We need to audit on this. Let's queue a task to audit our tests for stupid."

## Concept

Tests should assert on:
- Logic / behavior (what the function does).
- Structure / shape (what the response looks like — fields, types).
- Boundary conditions (errors, edge cases).

Tests should NOT assert on:
- Specific copy strings ("contains 'reactions help topic'" — copy churn breaks tests).
- Markdown formatting details ("starts with `## `" — formatter changes break tests).
- Exact message wording ("exactly 5 minutes" vs "5 min" — see 10-0880's help.test.ts assertion update fiasco).

## Goal

Survey `src/**/*.test.ts` (and any other test directories) for content-string assertions. For each:
- If asserting CRITICAL copy (e.g., security warnings, machine-readable error codes), keep but mark with a comment ("intentional copy assertion — required for X").
- If asserting NON-CRITICAL copy (help text, descriptions, comments), replace with a structure assertion ("response.body has key 'help', value is a non-empty string") OR delete entirely.

## Acceptance criteria

- Spreadsheet / report listing every test that asserts on content strings, classified as: critical-keep / non-critical-replace / delete.
- All non-critical-replace cases refactored to structure assertions.
- Delete cases removed.
- Test count may go down; coverage stays.
- `pnpm test` passes 100%.

## Out of scope

- Adding new tests.
- Refactoring test infrastructure.
- Changing test runner config.

## Branch flow

Work directly on `release/7.4`. Stage, run `pnpm test`, DM Curator. Push when green.

## Bailout / presence

- No fixed time cap.
- At 5 min in: "still working on 10-0882" status DM to Overseer.
- Every 5 min after: status with what's taking longer and why.
- Visible checklist throughout — operator's primary progress signal.
- If audit reveals widespread reliance on copy assertions (>50 sites), surface to operator before refactoring — could indicate tests are doing too much UI-style testing, separate concern.
