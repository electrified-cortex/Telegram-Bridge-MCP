---
Created: 2026-05-27
Status: needs-refinement
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

## Gate bounce — Overseer 2026-06-20

BOUNCE — 4 open design questions block implementation:

1. Flag name/type unresolved (`suppress_pending_hint: boolean` is a proposal, not a decision)
2. Mechanism unresolved: `profile/save` vs dedicated `profile/suppress-pending-hint` path
3. Persistence scope unresolved: profile-level vs session-level
4. Scope unresolved: suppress hint field entirely vs suppress nudge text only

AC#3 ("set/cleared via existing profile/save mechanism") contradicts open question #2. Fix: resolve all 4 design questions, then rewrite ACs to match the decided design. Also: `priority: medium` must be numeric.
