# 20 - Profile autoload missing on session/reconnect

**Source:** Operator-reported via S-IM 2026-06-08. Code-grounded by agent verification against `src/tools/session/start.ts`.

## Problem (verified)

`handleSessionStart` applies the profile on autoload, but `handleSessionReconnect` does NOT — so reconnecting a session never re-applies its voice / animation presets / reminders until a manual `profile/load`.

Verified in `src/tools/session/start.ts`:
- `handleSessionStart` (L223) autoloads: L461-464
  ```
  const profile = readProfile(effectiveName);
  if (profile && (autoload_profile === true || profile.autoload === true)) {
    applyProfile(session.sid, profile);
    res.profile_autoloaded = effectiveName;
  }
  ```
- `handleSessionReconnect` (L478) restores the session: validates name, finds `existing`, reconnect-approval dialog, resets health markers (L525-528), `setActiveSession` (L530), delivers service messages (L532+) — but has **NO `readProfile`/`applyProfile` call** anywhere. (`readProfile`/`applyProfile` are imported at L20-21 and used only inside `handleSessionStart`.)

**Repro:** An agent did `session/reconnect` with an `autoload: true` profile; `reminder/list` came back empty until a manual `profile/load`.

## Fix

In `handleSessionReconnect`, after the session restoration (after `setActiveSession(existing.sid)` ~L530), add a block mirroring L461-464:
```
const profile = readProfile(existing.name);
if (profile && profile.autoload === true) {
  applyProfile(existing.sid, profile);
  // surface res.profile_autoloaded = existing.name in the reconnect response
}
```
Note: `handleSessionReconnect` currently takes only `{ name }` (no `autoload_profile` param), so gate on `profile.autoload === true`. Optionally add an `autoload_profile` param for full parity with start — confirm desired surface.

## Acceptance criteria

- AC1: After `session/reconnect` on a profile with `autoload: true`, voice + animation presets + reminders are restored WITHOUT a manual `profile/load`.
- AC2: `reminder/list` is non-empty post-reconnect when the profile defines reminders.
- AC3: The reconnect response surfaces `profile_autoloaded` (parity with start), or documents why not.
- AC4: Existing `session/start.ts` tests still pass; add a reconnect-autoload regression test.

## Delegation / gates

- Small, well-bounded (few-line add + test). Agent implements; coordinator stages; **operator commits**.

## Related

- Relevant to participant skills that assume "profile survives reconnect" (it does NOT, currently) — e.g. Curator/operator telegram-participation reconnect flow.
