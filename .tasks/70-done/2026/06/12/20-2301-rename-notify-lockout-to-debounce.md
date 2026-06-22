---
id: "20-2301"
title: "Rename notify-lockout terminology to notify-debounce"
type: task
priority: 20
status: draft
created: 2026-06-12
repo: Telegram-Bridge-MCP
delegation: worker
---

# Rename notify-lockout terminology to notify-cooldown

## Background

Operator directive 2026-06-12: the term "lockout" is confusing and has negative connotations
("what did I do wrong?"). It implies punishment rather than describing what's actually
happening: a post-notify debounce window that prevents spam kicks.

The mechanism: after a session receives a notify kick, further kicks are suppressed for
LOCKOUT_DEFAULT_MS (5 minutes). This is a cooldown/debounce — not a lockout in the security
sense.

## Goal

Rename the lockout-related identifiers across the codebase to use clearer terminology.
**Decided term: debounce** (operator confirmed 2026-06-12).
Rationale: "you're not going to get extra messages until you DQ" — that's exactly what debounce means.

## Scope

Rename the following (exact list to be confirmed during implementation):
- `_lockoutRelease` → `_cooldownRelease` (or `_debounceRelease`)
- `releaseNotifyLockout()` → `releaseNotifyCooldown()`
- `LOCKOUT_DEFAULT_MS` → `NOTIFY_COOLDOWN_MS`
- `LOCKOUT_MIN_MS` / `LOCKOUT_MAX_MS` → `NOTIFY_COOLDOWN_MIN_MS` / `NOTIFY_COOLDOWN_MAX_MS`
- `notifyPendingBecauseLocked` → `notifyPendingBecauseCooldown`
- `profile/kick-lockout` action path → `profile/notify-cooldown` (with backward-compat alias)
- Any comments, doc strings, or user-visible text using "lockout" in this context

## Out of scope

- Changing the behavior of the mechanism (debounce window stays at 5 min default)
- Security-related uses of "lockout" (if any exist elsewhere in the codebase)

## Acceptance criteria

- No public API breakage (backward-compat alias on renamed action path if needed)
- All references to the old naming updated in src/, tests/, and docs
- CHANGELOG entry explaining the rename
- Existing tests pass; add/update tests if naming appears in assertions

## Notes

The term "debounce" has prior art in the codebase (operator and team already use it
conversationally). Either debounce or cooldown is acceptable; Curator/operator to decide
on final term before implementation begins.

## Verification

APPROVED 2026-06-12 — Verifier confirmed: all functional lockout identifiers renamed to debounce across 20 files, kick-lockout.ts→notify-debounce.ts, profile/kick-lockout backward-compat alias present, CHANGELOG entry added, 3422/3422 tests pass. Only 3 intentional legacy refs remain (1 unrelated comment, 1 backward-compat alias string, 1 historical task ref in comment). Commit e86c5e6c.

Sealed-By: foreman
