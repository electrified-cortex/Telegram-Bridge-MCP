---
Created: 2026-05-27
Status: draft
Priority: medium
Source: 2026-05-27 refactor scan
---

# dequeue.ts — Implement ProfileData.suppress_pending_hint flag

## Problem

`src/tools/dequeue.ts:246` — The pending hint (message shown when `pending > 0`) is currently hardcoded with no way for sessions to suppress it. A `TODO` at line 246 notes that `ProfileData.suppress_pending_hint` should be implemented as a per-session profile flag.

Use cases: agents that process their own pending logic don't need the nudge; governor sessions may want to suppress for clean output.

## Design Questions (to resolve before implementation)

- What is the exact flag name and type? (`suppress_pending_hint: boolean` on `ProfileData`?)
- Is this set via `profile/save` + `profile/load`, or via a dedicated `profile/suppress-pending-hint` path?
- Does the flag persist across reconnects (profile-level) or is it session-level only?
- Should it suppress the hint entirely or just the nudge text (leaving the `pending` count)?

## Proposed Shape

```ts
// ProfileData (profile-manager.ts)
suppress_pending_hint?: boolean;
```

When `suppress_pending_hint === true` in the active session profile, omit the `"hint"` field from dequeue responses regardless of `pending` count.

## Acceptance Criteria

- [ ] `ProfileData` gains `suppress_pending_hint?: boolean`.
- [ ] `dequeue.ts` checks the profile flag before appending the hint.
- [ ] Flag is set/cleared via the existing `profile/save` mechanism.
- [ ] Tests cover: flag absent (hint appears), flag true (hint suppressed), flag false (hint appears).
- [ ] help('dequeue') or help('profile') updated to document the flag.

## Operator design decision (2026-06-12)

Design questions resolved. The implementation is simpler than the flag approach:

**Rule: suppress the pending hint when pending = 0. No per-session flag needed.**

Rationale: if there's nothing pending, the hint adds no value. Goal is minimal payload.
"If it says pending zero, it's not necessary to show pending." — Operator.

This is a global behavior change (not session-scoped) — just don't emit the hint field
when it would be zero. Implementation target: dequeue.ts lines 307-308 (active TODO).

## Verification

APPROVED 2026-06-12 — Verifier confirmed: TODO comment removed (commit 94b42cdd), `if (pending > 0)` guard unchanged and correct, no `suppress_pending_hint` references remain in src/, all 4 test cases present in dequeue.test.ts, 3422/3422 tests passed.

Sealed-By: foreman
