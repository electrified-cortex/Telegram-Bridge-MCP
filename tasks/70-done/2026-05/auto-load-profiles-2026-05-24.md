# Auto-load profiles on session start

**Captured:** 2026-05-24 (PT)
**Source:** operator voice msg 61048 (skipped buttoned question to drop this)
**Target version:** v7.6 per operator
**Status:** Draft for Overseer review

---

## Verbatim — msg 61048

> Heads up, another feature that should have already been added, or at least somewhere is in tasks, is auto-loading profiles. Okay, if the, whatever the profile that, whatever the name that's used to start the session, you should be able to use an auto-load profile. If they're allowed in, then that's it. Okay, so let's add that feature. It'll be part of 7.6. It has to be opted in, though. It's a configuration setting. And the configuration setting can be set by the agent. Maybe even set per profile if it's auto-load.

---

## Conceptual model

When a session calls `session/start` with a `name` parameter, the bridge attempts to auto-load the profile matching that name — IF auto-load is enabled.

This eliminates the boilerplate of every agent doing:
```
const token = await session/start({ name: 'Curator', ... })
await profile/load({ key: 'Curator', token })
```
Into just:
```
const token = await session/start({ name: 'Curator', ... })
// profile already loaded
```

## Opt-in

Auto-load is **OFF by default** (operator-directed). Two enable paths:

1. **Session-level opt-in:** `session/start` accepts a new param like `autoload_profile: true` (default false). When true and a profile matching `name` exists, it's loaded.
2. **Per-profile opt-in:** profile has an `autoload: true` flag. When `session/start` runs with a name matching a profile that has `autoload: true`, it's loaded regardless of session-level param.

Both paths must be opt-in to avoid surprising behavior.

## Acceptance criteria

- **AC1**: `action({ type: 'session/start', name: 'Curator' })` does NOT auto-load any profile by default (current behavior preserved).
- **AC2**: `action({ type: 'session/start', name: 'Curator', autoload_profile: true })` looks up profile `Curator` and applies it after session creation, if it exists.
- **AC3**: If `autoload_profile: true` but no profile matches `name`, session starts normally with no profile applied (no error).
- **AC4**: `action({ type: 'profile/save', key: 'Curator', autoload: true, ... })` flags the profile as auto-load-enabled.
- **AC5**: When `session/start` is called with `name` matching a profile that has `autoload: true`, the profile is auto-applied regardless of the session-level `autoload_profile` param.
- **AC6**: `profile/save` continues to default `autoload: false` (opt-in).
- **AC7**: `profile/load` and `profile/save` continue to accept the `autoload` flag for explicit per-profile control.
- **AC8**: Tests cover all four combinations: (session opt-in or not) x (profile opt-in or not).
- **AC9**: Documentation in `help(topic: 'session')` and `help(topic: 'profile')` updated to describe auto-load behavior.

## Files in scope

- `src/tools/session/start.ts` — accept `autoload_profile` param; orchestrate profile load after session create
- `src/tools/profile/save.ts` — accept + persist `autoload` flag
- `src/tools/profile/load.ts` — confirm `autoload` returned by load
- `src/profile-store.ts` — `autoload` field on profile schema
- `src/tools/profile/import.ts` — accept `autoload` on import
- `src/tools/profile/save.test.ts` + `start.test.ts` — coverage per AC8
- `help.md` (or equivalent) — docs

## Open questions

- **OQ1**: If both session-level `autoload_profile: false` AND profile-level `autoload: true`, which wins? Lean: profile-level wins (the profile owner opted in explicitly).
- **OQ2**: What about `session/reconnect`? Should it auto-load too if profile flagged? Lean: no — reconnect resumes existing session state, profile already in memory.

## Delegation

- Spec author: Curator
- Vet + queue: Overseer
- Implementation: Worker pod with TMCP context

## Priority

HIGH per operator — bundled into v7.6 release.

---

## Overseer review

- **Reviewer:** Overseer
- **Date:** 2026-05-24
- **Verdict:** APPROVED
- **Review type:** adversarial-manual

**Checked:** ACs 1–9 all binary and testable ✓, scope clear and bounded (7 files) ✓, delegation correct ✓, OQ1+OQ2 have explicit lean positions (profile-level wins; reconnect excluded) ✓, default-off opt-in design sound ✓.

**Not checked:** technical correctness of profile-store schema migrations, session/start middleware ordering.

**Note:** `profile/import` is listed in files-in-scope but has no dedicated AC. Worker should add a test that `profile/import({ autoload: true })` persists the flag and that a subsequent `profile/load` returns it — treat this as AC8 scope extension, not a new AC.

## Claimant

Foreman session. Worker session: 6274bf95. Worktree: .foreman-pod/.worktrees/auto-load-profiles-2026-05-24

## Verification

Verifier: foreman dispatch (sonnet-class)
Date: 2026-05-25
Verdict: APPROVED

All 9 ACs confirmed with code and test citations. 3254/3254 tests pass. `profile/import` autoload non-persistence is intentional and explicitly documented — acceptable per verifier. Squash-merged to `dev` as `c0a6ba7`.
