# 052 — Confirm Tool: OK/Cancel Default + confirmYN Alias

## Problem

The `confirm` tool currently defaults to `🟢 Yes` / `🔴 No` buttons. This is fine for explicit yes/no questions, but most confirmations are really "proceed or abort" — `OK` / `Cancel` is a better default for that pattern.

## Changes

### 1. Change `confirm` defaults

| Parameter | Current Default | New Default |
| --- | --- | --- |
| `yes_text` | `🟢 Yes` | `OK` |
| `no_text` | `🔴 No` | `Cancel` |
| `yes_style` | (none) | `primary` |
| `no_style` | (none) | (none — neutral/gray) |

Update `DESCRIPTION` to reflect the new OK/Cancel default.

### 2. Register `confirmYN` alias

Register a second tool `confirmYN` that uses the same handler but with `🟢 Yes` / `🔴 No` defaults (the current behavior). This preserves the yes/no pattern for questions that genuinely need it.

| Parameter | Default |
| --- | --- |
| `yes_text` | `🟢 Yes` |
| `no_text` | `🔴 No` |
| `yes_style` | (none) |
| `no_style` | (none) |

The description should say: "Yes/No confirmation variant. Same as confirm but defaults to 🟢 Yes / 🔴 No buttons."

### Implementation Notes

- Both tools share the same handler logic — extract the handler into a named function and register it twice with different default overrides
- No emoji on the OK/Cancel buttons (plain text + style is the visual signal)
- No new files — everything stays in `src/tools/confirm.ts`

## Files to Change

- `src/tools/confirm.ts` — change defaults, extract handler, register `confirmYN`
- `src/tools/confirm.test.ts` — update tests for new defaults, add tests for `confirmYN`
- `changelog/unreleased.md` — add entries

## Acceptance Criteria

- [x] `confirm` defaults to OK (primary) / Cancel (unstyled), no emoji
- [x] `confirmYN` defaults to 🟢 Yes / 🔴 No, no style
- [x] Both tools accept the same parameters and share the same handler
- [x] Existing tests updated for new defaults
- [x] New tests for `confirmYN` defaults
- [x] Build passes, tests pass, lint passes
- [x] Changelog updated

## Completion

**Commit:** `4acda16`

**Files changed:**

- `src/tools/confirm.ts` — extracted `confirmHandler` + `makeInputSchema` helpers; changed `confirm` defaults to `OK`/`Cancel`/`primary`; registered `confirmYN` with old `🟢 Yes`/`🔴 No` defaults; removed unnecessary `as ButtonStyle` casts (lint)
- `src/tools/confirm.test.ts` — updated `ackAndEditSelection` hook test to expect `"OK"`; added `defaults to OK/Cancel` button label/style test; added `confirmYN tool` describe block (6 tests covering defaults, labels, custom overrides); fixed mock state leak (`sessionQueue.pendingCount.mockReturnValue(0)` in confirmYN's beforeEach)
- `changelog/unreleased.md` — added `Added` entry for `confirmYN`; added `Changed` entries for new `confirm` defaults

**Test results:** 1670 passed, 0 failed (90 test files)
