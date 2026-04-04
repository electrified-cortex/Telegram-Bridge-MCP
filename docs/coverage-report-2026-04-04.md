# Code Coverage Audit — Telegram Bridge MCP

**Date:** 2026-04-04
**Test suite:** vitest v4.1.0 with v8 coverage provider
**Package version:** telegram-bridge-mcp v5.1.0
**Test results:** 97 test files passed, 1897 tests passed, 0 failures
**Duration:** 25.39s

---

## Overall Coverage

| Metric      | All Files | src/       | src/tools/ |
| --- | --- | --- | --- |
| Statements  | 90.05%    | 86.63%     | 96.17%     |
| Branches    | 83.87%    | 79.02%     | 91.56%     |
| Functions   | 85.83%    | 84.30%     | 89.10%     |
| Lines       | 91.60%    | 88.10%     | 97.90%     |

Overall coverage is healthy. The `src/tools/` layer is well-tested (96%+ statements). The core `src/` layer is weaker, particularly for branches (79.02%) and functions (84.30%).

---

## Files Below 80% Threshold

Any file where **any** of statements, branches, or functions falls below 80% is listed. Files at 0% (completely untested) are in their own section below.

### src/ — Core Files

| File | Statements | Branches | Functions | Lines | Notes |
| --- | --- | --- | --- | --- | --- |
| `voice-state.ts` | 66.66% | 60.00% | 55.55% | 66.66% | All metrics well below 80% |
| `telegram.ts` | 74.80% | 70.83% | 87.80% | 74.65% | Stmts + branches below 80% |
| `session-queue.ts` | 78.57% | 74.60% | 76.92% | 81.48% | Stmts, branches, funcs below 80% |
| `poller.ts` | 88.33% | 71.42% | 75.00% | 90.82% | Branches + funcs below 80% |
| `built-in-commands.ts` | 85.47% | 75.00% | 78.66% | 87.95% | Branches + funcs below 80% |
| `health-check.ts` | 90.00% | 76.19% | 47.61% | 92.45% | Branches + funcs below 80% |

### src/tools/ — Tool Handler Files

| File | Statements | Branches | Functions | Lines | Notes |
| --- | --- | --- | --- | --- | --- |
| `save_profile.ts` | 77.50% | 77.27% | 100.00% | 78.37% | Stmts + branches below 80% |

---

## Files With 0% Coverage (Completely Untested)

| File | Statements | Branches | Functions | Lines | Uncovered Lines |
| --- | --- | --- | --- | --- | --- |
| `src/launcher.ts` | 0.00% | 0.00% | 0.00% | 0.00% | 7–174 (entire file) |
| `src/two-lane-queue.ts` | 0.00% | 0.00% | 0.00% | 0.00% | entire file |

These files have no test coverage whatsoever and are critical gaps.

---

## Files of Special Interest (V5 Additions and Refactors)

### `src/session-gate.ts` (auth — refactored in V5)

| Statements | Branches | Functions | Lines | Uncovered Lines |
| --- | --- | --- | --- | --- |
| 87.50% | 100.00% | **50.00%** | 87.50% | line 12 |

**Assessment:** Function coverage is notably low at 50% — half the functions have no tests. Branch coverage is perfect at 100%, which is good for auth logic. Line 12 is uncovered. The low function coverage means some auth code paths (likely error or edge-case functions) are never exercised. Given this is a security-critical module, the 50% function coverage is a concern.

### `src/tools/set_dequeue_default.ts` (new in V5)

| Statements | Branches | Functions | Lines | Uncovered Lines |
| --- | --- | --- | --- | --- |
| 100.00% | 100.00% | 100.00% | 100.00% | none |

**Assessment:** Excellent — fully covered. No gaps.

### `src/session-queue.ts` (reminder delivery — new in V5)

| Statements | Branches | Functions | Lines | Uncovered Lines |
| --- | --- | --- | --- | --- |
| 78.57% | 74.60% | 76.92% | 81.48% | includes lines 244–274, 411–426 |

**Assessment:** This file is below the 80% threshold on all three primary metrics (statements, branches, functions). Given this is a new V5 module implementing reminder delivery — which is a user-visible, time-sensitive feature — coverage gaps here are significant. Lines 244–274 and 411–426 are uncovered. These likely represent error-handling paths, edge-case delivery logic, or cancellation flows in the reminder queue.

### `src/profile-store.ts` (reminder migration — new in V5)

| Statements | Branches | Functions | Lines | Uncovered Lines |
| --- | --- | --- | --- | --- |
| 95.45% | 91.66% | 100.00% | 95.23% | line 53 |

**Assessment:** Well-covered. Only one line (53) is uncovered. This is likely a defensive error branch in the migration path. No action required beyond a note.

---

## Recommendations

### Priority 1 — Immediate Action Required

**`src/launcher.ts` and `src/two-lane-queue.ts` (0% coverage)**

These files have zero test coverage. `launcher.ts` spans lines 7–174, making it a substantial untested module. If these files are part of the active runtime (not dead code), tests must be written before the next release. If they are intentionally excluded (e.g., integration-only or startup shims), they should be explicitly excluded from coverage thresholds in `vitest.config.ts`.

**`src/session-gate.ts` — 50% function coverage (auth module)**

Auth logic should have the highest coverage standards, not the lowest. The 50% function coverage means half the gate's functions are never exercised by tests. Write tests covering:
- All exported functions, especially any that handle token validation failures
- Edge cases: expired tokens, invalid PINs, concurrent session conflicts

### Priority 2 — Below Threshold, Should Improve

**`src/session-queue.ts` (78.57% stmts / 74.6% branches / 76.92% funcs)**

This is a new V5 module for reminder delivery. All three metrics are below 80%. Uncovered lines 244–274 and 411–426 likely represent reminder cancellation, expiry, or error recovery flows. Tests should cover:
- Reminder delivery success and failure paths
- Queue drain behavior on session end
- Concurrent reminder scheduling edge cases

**`src/voice-state.ts` (66.66% stmts / 60% branches / 55.55% funcs)**

The lowest coverage of any non-zero file in `src/`. Lines 40–55 are uncovered. This likely includes state transitions or cleanup paths. Recommend writing tests for all state transitions.

**`src/telegram.ts` (74.8% stmts / 70.83% branches)**

This is likely the core Telegram API interface layer — a large and critical file. The uncovered lines include a range around 549–609, 613, and 723. These may be retry paths, error handlers, or rarely-triggered API edge cases. Given the file's size and centrality, even moderate coverage gaps can hide real bugs.

**`src/tools/save_profile.ts` (77.5% stmts / 77.27% branches)**

Uncovered lines 56–57 and 67–73 likely represent error paths in profile serialization or file-write failure handling. These should be covered with mock-based error injection tests.

**`src/health-check.ts` — 47.61% function coverage**

Only about half the functions in the health-check module are exercised. The uncovered lines (265–267, 274–275) and low function coverage suggest significant health-check scenarios go untested.

**`src/poller.ts` — 71.42% branch / 75% function coverage**

The poller is a core runtime loop. Uncovered lines (210–211, 248–249) and low function coverage suggest error recovery or backoff paths are untested.

### Priority 3 — Monitor

**`src/built-in-commands.ts` (75% branches / 78.66% funcs)**

A broad command handler file. Branch coverage of 75% means many command-handling conditionals have no test path. This is an area where bugs can silently lurk. Gradually add tests for each command branch.

**`src/profile-store.ts` — line 53 uncovered**

Single uncovered line, likely a defensive branch. Low risk but worth a targeted test.

---

## Coverage Configuration Note

The worktree `10-263` did not exist at time of report creation. This report was saved to `docs/coverage-report-2026-04-04.md` in the main working tree. The Worker should stage and commit from the appropriate branch or worktree.
