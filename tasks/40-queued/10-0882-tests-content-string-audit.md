---
id: "10-0882"
title: "Audit tests for content-string assertions (test logic, not copy)"
type: refactor
priority: 30
status: queued
created: 2026-05-05
filed-by: Curator
delegation: Worker
target_repo: telegram-bridge-mcp
target_branch: dev
---

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

Work directly on local `dev`. Stage, run `pnpm test`, DM Curator.

## Bailout

- 90 min cap.
- If audit reveals widespread reliance on copy assertions (>50 sites), surface to operator before refactoring — could indicate tests are doing too much UI-style testing, separate concern.
