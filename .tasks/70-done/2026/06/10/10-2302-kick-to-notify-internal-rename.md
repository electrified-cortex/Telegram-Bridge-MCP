---
id: 10-2302-kick-to-notify-internal-rename
title: "7.9.1 — Rename internal 'kick' → 'notify' (verb unification)"
created: 2026-06-10
status: draft
priority: 10
type: refactor
branch: dev-7.9.1
---

# 7.9.1 — Internal rename: `kick` → `notify`

## Context

The term "kick" originated as a low-level implementation detail — a signal to wake
a parked agent. With the notification-wake-contract spec landing in 7.10, the domain
vocabulary is being unified: the correct verb is **notify**. "Kick" is now a legacy
synonym that should exist only as a public API deprecation alias.

This task executes the internal rename so that 7.10 builds on a clean foundation.
Zero breaking changes — public API deprecation aliases remain.

## Scope

**363 occurrences (confirmed count as of 7.9.0):**
- 188 code occurrences (`.ts` / `.js` source files)
- 175 test occurrences (`.test.ts` / `.spec.ts`)
- 6 documentation occurrences (`.md` files in `docs/`)

**Verb is LOCKED: `notify`** — use as both noun and verb where needed:
- `kickSession` → `notifySession`
- `kickIfAllowed` → `notifyIfAllowed`
- `releaseKickLockout` → `releaseNotifyLockout`
- `kickSseSubscriber` → `notifySubscriber` (or `notifySseSubscriber`)
- Internal comments, variable names, test descriptions — all updated

**Deprecation aliases — KEEP, zero breakage:**
These public API path strings shipped in 7.8.3 and must remain as aliases:
- `profile/kick-lockout` → keep as alias for `profile/notify-lockout`
- `profile/kick-debounce` → keep as alias for `profile/notify-debounce`
- `ms` parameter on `profile/kick-lockout` action — unchanged interface

## Implementation approach

Prefer a bulk rename pass:
1. `grep -rn "kick" src/ --include="*.ts"` to enumerate all sites
2. Rename function/variable/type names (not string literals that form public API paths)
3. Update all tests to use new names
4. Update docs/ markdown (6 files)
5. Confirm deprecation aliases still route correctly
6. Run full test suite on `dev-7.9.1` — all tests must pass

## Branch

`dev-7.9.1` — branch off `main` (post 7.9.0 merge at `3034645d`)

## Acceptance criteria

1. All internal `kick*` function/variable/type names replaced with `notify*` equivalents.
2. String literals forming public API paths (`profile/kick-lockout`, `profile/kick-debounce`) preserved as deprecation aliases.
3. All 363 occurrences accounted for — no stale `kick` references in code or tests except the alias strings.
4. Full test suite passes on `dev-7.9.1` (same baseline as 7.9.0: 3371 tests).
5. PR targets `main` (or `dev` if a staging branch is preferred), labeled `7.9.1`.

## Out of scope

- notification-wake-contract build items (§5-a/b/c) — those are 7.10
- Any behavior change — this is a pure rename refactor
- Removing the public API deprecation aliases — keep indefinitely until major version

## Notes

- Curator confirmed verb locked to `notify` (2026-06-10)
- Count source: Curator analysis on 7.9.0 codebase

## Task gate stamp

**Verdict:** PASS
**Stamped by:** Overseer
**Date:** 2026-06-10
**Checked:** ACs binary+testable ✅ | scope bounded ✅ | delegation correct ✅ | no open questions ✅ | well-specced ✅
