---
id: "10-0882"
title: "Audit tests for content-string assertions (test logic, not copy)"
type: refactor
priority: 10
verification: APPROVED
verified-by: Opus (Overseer-dispatched)
verified-at: 2026-05-07
verified-commit: 3d16c1df
status: queued
created: 2026-05-05
updated: 2026-05-06
filed-by: Curator
delegation: Worker
target_repo: telegram-bridge-mcp
target_branch: dev
updated: 2026-05-07
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

## Update 2026-05-07 — NEEDS_REVISION (Opus audit)

PR #167 scrub only touched 10 files. ~30+ clear copy-content violations remain across 12 additional test files. Fix these then DM Overseer "10-0882 revision complete".

### Required fixes

**`src/tools/session/close.test.ts`** (~10 violations):
- L189, L237: `stringContaining("Governor session closed")` → assert on `event_type: "session_closed"` or `closed_name` field
- L202, L380: `stringContaining("has disconnected")` → assert on `event_type`
- L225: `stringContaining("promoted to governor")` → assert on `eventType: "session_joined"` or governor SID field
- L296, L311, L326: `stringContaining("Single-session mode restored")` → structural check
- L395, L405, L415, L549: `stringContaining("X has disconnected.")` → assert on closed SID
- L714-715: `toContain("You are the last session")`, `toContain("action(type: 'shutdown')")` → structural shutdown check

**`src/tools/session/start.test.ts`** (~7 violations):
- L835: `toContain("Save your token")` → assert token field present
- L850: `not.toContain("You are a participant session")` → assert role field
- L1259-1260: `toContain("New session requesting access")` → assert pending_count or event_type
- L1820: `toContain("already online")` → assert error code
- L1965, L1995: `toContain("Reconnect authorized")` → assert status field
- L1285-1286: `toContain("joined")` / `toContain("reconnected")` → assert event_type

**`src/tools/session/close-signal.test.ts`**: L171 `toContain("Governor")`, L232 `toContain("changed during wait")` → structural

**`src/tools/shutdown/warn.test.ts`**: L43, L55-56, L118 → assert event_type and payload fields, not prose

**`src/tools/built-in-commands.test.ts`** (~5 violations): L503 "Voice Selection", L519 "No voices found", L544 "config override", L585 "American", L1067 "🟡 Auto-approve..." → assert on button callbacks/types not label text

**`src/tools/profile/load.test.ts`** (~4 violations): L110-111, L169, L204-242 → assert on reminder count numbers, not summary phrase wording

**`src/tools/dequeue.test.ts`**: L1292 `stringContaining("Duplicate session detected")` → assert `event_type: "duplicate_session"` or code field

**`src/tools/send/notify.test.ts`**: L84 `toContain("ℹ️")` → assert severity field

After fixing: run full test suite (must stay green), commit to TMCP dev, DM Overseer.

## Branch flow

Work on `dev`. Stage, run `pnpm test`, DM Overseer "10-0882 revision complete" when green.

## Bailout / presence

- No fixed time cap.
- At 5 min in: "still working on 10-0882" status DM to Overseer.
- Every 5 min after: status with what's taking longer and why.
- Visible checklist throughout — operator's primary progress signal.
- If audit reveals widespread reliance on copy assertions (>50 sites), surface to operator before refactoring — could indicate tests are doing too much UI-style testing, separate concern.
