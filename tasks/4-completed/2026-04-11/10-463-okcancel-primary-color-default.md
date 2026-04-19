---
Created: 2026-04-10
Status: Draft
Host: local
Priority: 10-463
Source: Operator
---

# 10-463: OKCancel preset — OK button should use primary color

## Problem

The `OKCancel` button preset does not default the OK button to the primary (session)
color. The OK button should visually stand out as the primary action.

## Acceptance Criteria

- [x] OKCancel preset renders OK button with session's primary color
- [x] Cancel button remains neutral/default
- [x] Other presets with a primary action follow the same pattern
- [x] No regression on existing button presets

## Completion

**Branch:** `10-463` | **Commit:** `8985914`

### What changed (3 files)

- **`src/tools/send.ts`** — `yes_style` schema changed from `.optional()` to `.default("primary")` in the question/confirm schema. When `send(type: "question", confirm: "...")` is called without `yes_style`, Zod fills in `"primary"` before it reaches `handleConfirm`.
- **`src/tools/send.test.ts`** — New test: `type: question/confirm — yes_style defaults to "primary" when not provided`. Asserts `handleConfirm` called with `yes_style: "primary"` when omitted by caller.
- **`src/action-registry.ts`** — Removed redundant `Promise<unknown> |` from `ActionHandler` return type (pre-existing lint fix).

### Notes

- The standalone `confirm` tool and `confirm/ok-cancel` action already defaulted to primary. This fix aligns `send(type: "question", confirm: ...)` to match.
- `no_style` left as `.optional()` — Cancel stays neutral.
- Code review: Clean — no findings.
- 2202 tests pass.
