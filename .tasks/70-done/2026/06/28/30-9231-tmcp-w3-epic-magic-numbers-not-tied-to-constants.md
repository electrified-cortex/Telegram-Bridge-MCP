---
created: 2026-06-27
status: queued
overseer-stamp: PASS — 2026-06-28T02:39Z
priority: 10
source: TMCP V8 quality audit wave 3 (unit-test-snob), 2026-06-28 — consolidated epic
repo: electrified-cortex/Telegram-Bridge-MCP
type: TechDebt
severity: medium
persona: unit-test-snob
pattern: magic-numbers
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
---

# TMCP Overhaul [unit-test-snob Epic]: Magic Numbers in Tests Not Tied to Production Constants

**ID**: 30-9231
**Date**: 2026-06-27
**Persona**: unit-test-snob
**Pattern**: Numeric (and shadow-copy) constants duplicated between production and test without linkage

## Problem

Three test files hardcode numeric or timeout values that are copies of production constants, but without importing those constants. The consequence is silent drift: if the production value changes, the test continues to assert the old value, either passing on the wrong threshold or failing for the wrong reason. In the worst case (`RECORDING_INDICATOR_SAFETY_MS_FOR_TEST`), the test file even admits in a comment that it is mirroring a private production constant — but because the production constant is not exported, the test cannot import it and instead maintains an independent copy that is guaranteed to drift.

The repair is straightforward: export the constant from the production module and import it in the test. One source of truth.

## Covers

Consolidates the following wave-3 source tasks (all now in `.tasks/.trash/`):

| ID | File | Issue |
|----|------|-------|
| 30-9206 | abs-path-guard.test.ts line 106 | Magic number `60` should be `MAX_SNIPPET_LENGTH` |
| 30-9215 | async-send-queue.test.ts lines 95-97 | `RECORDING_INDICATOR_SAFETY_MS_FOR_TEST = 120_000` shadows private constant |
| 30-9224 | cli-args.test.ts lines 10, 23, 35 | Magic number `3099` should be `DEFAULT_HTTP_PORT` |

## Offending Code

### 30-9206 — abs-path-guard.test.ts
```typescript
// Magic number 60 not linked to production constant
expect(result!.length).toBeLessThanOrEqual(60);
```

### 30-9215 — async-send-queue.test.ts
```typescript
// Comment admits this is a mirror — but the production constant is not exported
// Mirrors RECORDING_INDICATOR_SAFETY_MS from async-send-queue.ts.
const RECORDING_INDICATOR_SAFETY_MS_FOR_TEST = 120_000;
```

### 30-9224 — cli-args.test.ts
```typescript
// DEFAULT_HTTP_PORT is exported from cli-args.ts but the test re-hardcodes it
expect(resolveHttpPort(["node", "index.js", "--http"], {})).toBe(3099);
```

## Fix

### Fix for 30-9206 (abs-path-guard)
```typescript
// BEFORE (abs-path-guard.ts line 33):
const MAX_SNIPPET_LENGTH = 60;  // private

// AFTER:
export const MAX_SNIPPET_LENGTH = 60;

// BEFORE (abs-path-guard.test.ts line 106):
expect(result!.length).toBeLessThanOrEqual(60);

// AFTER:
import { MAX_SNIPPET_LENGTH } from "./abs-path-guard.js";
expect(result!.length).toBeLessThanOrEqual(MAX_SNIPPET_LENGTH);
```

### Fix for 30-9215 (async-send-queue)
```typescript
// BEFORE (async-send-queue.ts line ~238):
const RECORDING_INDICATOR_SAFETY_MS = 120_000;  // private, not exported

// AFTER:
export const RECORDING_INDICATOR_SAFETY_MS = 120_000;

// BEFORE (async-send-queue.test.ts lines 95-97):
// Mirrors RECORDING_INDICATOR_SAFETY_MS from async-send-queue.ts.
const RECORDING_INDICATOR_SAFETY_MS_FOR_TEST = 120_000;

// AFTER (delete the local constant; import the production one):
import { RECORDING_INDICATOR_SAFETY_MS } from "./async-send-queue.js";
// Replace all references to RECORDING_INDICATOR_SAFETY_MS_FOR_TEST
// with RECORDING_INDICATOR_SAFETY_MS throughout the test file.
```

### Fix for 30-9224 (cli-args)
```typescript
// DEFAULT_HTTP_PORT is already exported from cli-args.ts — simply import it:
// BEFORE (cli-args.test.ts lines 10, 23, 35):
expect(resolveHttpPort(["node", "index.js", "--http"], {})).toBe(3099);

// AFTER:
import { DEFAULT_HTTP_PORT } from "./cli-args.js";
expect(resolveHttpPort(["node", "index.js", "--http"], {})).toBe(DEFAULT_HTTP_PORT);
// Apply this replacement at all three occurrences (lines 10, 23, 35).
```

## Acceptance Criteria

- [ ] `grep -c '\.toBeLessThanOrEqual(60)' src/abs-path-guard.test.ts` returns `0`; the assertion uses `MAX_SNIPPET_LENGTH` imported from `abs-path-guard.ts`, and `MAX_SNIPPET_LENGTH` is exported from that module.
- [ ] `grep -c 'RECORDING_INDICATOR_SAFETY_MS_FOR_TEST' src/async-send-queue.test.ts` returns `0`; the local shadow constant is deleted and replaced with an import of `RECORDING_INDICATOR_SAFETY_MS` exported from `async-send-queue.ts`.
- [ ] `grep -c 'toBe(3099)' src/cli-args.test.ts` returns `0`; all three former occurrences use `DEFAULT_HTTP_PORT` from `cli-args.ts`.
- [ ] `tsc --noEmit` passes and all pre-existing tests pass after the changes.

## Delegation

Worker / Reviewer: Curator; Overseer gate required before merge.

## Verification

- Verifier: af7d943d649aa7823
- Date: 2026-06-28
- Verdict: APPROVED
- AC1 (abs-path-guard: MAX_SNIPPET_LENGTH): CONFIRMED — literal 60 gone, constant exported+imported
- AC2 (async-send-queue: RECORDING_INDICATOR_SAFETY_MS): CONFIRMED — shadow constant deleted, production export used
- AC3 (cli-args: DEFAULT_HTTP_PORT): CONFIRMED — literal 3099 gone, constant imported
- AC4 (tsc + tests pass): CONFIRMED — 4003/4003 pass, tsc clean
