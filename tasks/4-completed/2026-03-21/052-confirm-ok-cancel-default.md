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

- [ ] `confirm` defaults to OK (primary) / Cancel (unstyled), no emoji
- [ ] `confirmYN` defaults to 🟢 Yes / 🔴 No, no style
- [ ] Both tools accept the same parameters and share the same handler
- [ ] Existing tests updated for new defaults
- [ ] New tests for `confirmYN` defaults
- [ ] Build passes, tests pass, lint passes
- [ ] Changelog updated
