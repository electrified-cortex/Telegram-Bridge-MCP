---
created: 2026-06-28
status: draft
priority: 20
source: TMCP V8 quality audit swarm, 2026-06-28
repo: electrified-cortex/Telegram-Bridge-MCP
type: TechDebt
severity: low
dimension: brittle-string-assertions
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# TMCP Overhaul: Brittle exact-match on voice confirmation toast text

**ID**: 30-9000
**Date**: 2026-06-28
**Priority**: Low
**Dimension**: brittle-string-assertions
**File**: `D:/Users/essence/Development/cortex.lan/electrified-cortex/Telegram-Bridge-MCP/src/built-in-commands.test.ts`

## Problem

Line 764-767 asserts the exact toast text "Voice set to am_onyx" via answerCallbackQuery. Any rewording of that confirmation string breaks the test. The behavioral contract — that setDefaultVoice was called with the correct name — is already covered by the assertion at line 763. The toast text is cosmetic UX copy.

## Offending Code

```typescript
expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("cq1", { text: "Voice set to am_onyx" });
```

## Fix

Replace the exact string match with a partial match that preserves meaningful coverage without coupling to exact wording: expect(mocks.answerCallbackQuery).toHaveBeenCalledWith("cq1", { text: expect.stringContaining("am_onyx") }); This still verifies the voice name is echoed in the toast while tolerating future rewording of the surrounding copy. Only worth addressing in a broader test-quality pass, not as a standalone fix.

## Verification Notes

The finding is real: exact-string matching on user-visible copy is brittle. However, three factors reduce its severity below what the auditor claimed. First, the functional assertion (setDefaultVoice called with "am_onyx") is already present on the line immediately above, so this check adds only cosmetic coverage. Second, "Voice set to am_onyx" is a stable, simple template string — not dynamic prose — and an exact match on it does verify that the voice name is echoed correctly. Third, the same exact-match style is used in multiple other places in this file (e.g., "This panel has expired." at lines 485-488 and 1147-1150) without being flagged, making HIGH severity inconsistent. This is a minor test-quality issue, not a high-priority fix.

## Acceptance Criteria

- [ ] Issue resolved per fix description above
- [ ] `tsc --noEmit` passes
- [ ] All pre-existing tests pass
- [ ] The assertion at line 764 now uses `expect.stringContaining('am_onyx')` rather than a bare string literal

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer gate bounce

- Reviewer: Overseer
- Date: 2026-06-28
- Verdict: BOUNCE — AC4 ("No new brittle string assertions introduced") is not binary or testable. "Brittle" is subjective and the `(if test file)` conditional qualifier means a worker cannot evaluate this AC without judgment calls. Rephrase AC4 to a specific, observable criterion (e.g. "no raw string literals used in expect() assertions in the affected test file") or remove it entirely if the fix is self-contained.

## Overseer gate bounce #2

- Reviewer: Overseer
- Date: 2026-06-28
- Verdict: BOUNCE — AC4 main clause still overbroad: "no raw string literals in expect() calls remain in built-in-commands.test.ts" is a file-wide criterion, but the task fixes ONE assertion at line 764. Verification Notes in this spec acknowledge other exact-match assertions exist throughout the file (lines 485-488, 1147-1150). After a correct single-assertion fix, AC4 is false — raw literals remain. The "i.e." narrowing contradicts the main clause. Scope AC4 explicitly to the modified assertion only: "The assertion at line 764 now uses expect.stringContaining(...) rather than a bare string literal."

## Overseer stamp (re-gate pass 3)

- Reviewer: Overseer
- Date: 2026-06-28
- Verdict: PASS — AC4 now correctly scoped: "The assertion at line 764 now uses expect.stringContaining('am_onyx') rather than a bare string literal." Binary, testable, single-assertion scope. All 4 ACs pass gate criteria. Fix embedded (exact replacement shown in Fix section). Delegation correct. PASS.

## Verification

- Verifier: a9610e21644f749f3
- Date: 2026-06-27
- Verdict: APPROVED — expect.objectContaining({ text: expect.stringContaining("am_onyx") }) confirmed at built-in-commands.test.ts line 764. All 4 ACs confirmed. tsc clean. 4005/4005 tests pass.
- Sealed-By: Foreman, squash commit b1a14641c718586eb86a04ba80b327c231df0bf2, tests 4005/4005
