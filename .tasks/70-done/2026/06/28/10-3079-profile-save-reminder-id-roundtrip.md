---
title: "TMCP: profile/save must persist reminder id so round-trips preserve named reminders"
id: 10-3079
priority: HIGH
status: active
category: Bug
filed: 2026-06-28
source: TG 81352
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# Bug: profile/save drops reminder id — named reminders break on reload

## Problem

`profile/save` serializes reminders but omits the `id` field. On `profile/load`,
`apply.ts` regenerates a new id via `reminderContentHash()` — discarding any custom
id the caller originally set via `reminder/set { id: "my-named-reminder" }`. This
means named reminders cannot be cancelled or disabled by name after a reload cycle.

`only_if_silent` is already serialized correctly (fixed previously). Only `id` is
missing.

## Root cause

`src/tools/profile/save.ts` reminder map omits `...(r.id ? { id: r.id } : {})`.
`src/tools/profile/apply.ts` always computes `reminderContentHash()` even when
the saved data contains an explicit `id`.

## Fix

**save.ts** — add id to reminder map:
```ts
...(r.id ? { id: r.id } : {}),
```

**apply.ts** — use saved id when present; fall back to content hash:
```ts
const reminderId = (rd.id as string | undefined) ?? reminderContentHash(r.text, recurring, trigger);
```
(Apply this pattern to all 5 trigger branches.)

De-dup check `existing.some(e => e.id === reminderId)` works correctly with either
a saved id or a generated hash — no other changes needed.

## Acceptance Criteria

1. [ ] `profile/save` serializes the `id` field when present on a reminder
2. [ ] `profile/load` uses the saved `id` rather than re-hashing when `id` is present in saved data
3. [ ] Reminders without a custom `id` continue to use content-hash de-dup (no regression)
4. [ ] Unit test: save a session with a named reminder (`id: "my-reminder"`) → load it back → reminder exists with id `"my-reminder"`, no duplicate
5. [ ] `tsc --noEmit` clean, all pre-existing tests pass

## Scope

- `src/tools/profile/save.ts` — one-line addition to reminder map
- `src/tools/profile/apply.ts` — update `reminderId` derivation in all 5 trigger branches
- Test file for profile save/load

## Gate review

- reviewer: gate
- date: 2026-06-28
- verdict: PASS
- review type: adversarial gate
- checked: ACs 1-5 all binary+testable, scope bounded to 2 files + test, fix is a straightforward addition (not a redesign), de-dup logic unaffected, no open questions
<!-- overseer-gate: PASS 2026-06-28 -->

## Verification

- **verdict**: APPROVED
- **verifier**: Overseer (push-gate, bundled with 10-3078)
- **date**: 2026-06-28
- **worker_commit**: 6d8212c2
- **squash_commit**: af1606b9
- **tests**: 4179/4179 (171 test files — confirmed by foreman on branch HEAD 6d8212c2)
- **ACs**: 1-5 all PASS — id preserved in save.ts (all branches), apply.ts uses saved id via `?? reminderContentHash(...)` in all 5 trigger branches, round-trip test added
- **LLM pre-pass**: unavailable (gateway timeout) — flagged per protocol; Overseer gate substituted
