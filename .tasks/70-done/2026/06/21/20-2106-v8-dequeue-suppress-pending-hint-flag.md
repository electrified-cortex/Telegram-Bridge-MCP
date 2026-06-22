---
created: 2026-05-27
status: draft
priority: 20
source: 2026-05-27 refactor scan
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
dispatch_ready: true
needs_operator: false
---

# dequeue.ts — Implement ProfileData.suppress_pending_hint flag

## Problem

`src/tools/dequeue.ts:246` — The pending hint (message shown when `pending > 0`) is currently hardcoded with no way for sessions to suppress it. A `TODO` at line 246 notes that `ProfileData.suppress_pending_hint` should be implemented as a per-session profile flag.

Use cases: agents that process their own pending logic don't need the nudge; governor sessions may want to suppress for clean output.

## Design Decisions (resolved 2026-06-21)

- **Flag name and type:** `suppress_pending_hint: boolean` on `ProfileData` — matches proposed shape.
- **Set via:** existing `profile/save` + `profile/load` mechanism — no new action needed.
- **Persistence:** profile-level (persists across reconnects) — consistent with all other ProfileData fields.
- **Suppression scope:** suppress the entire `hint` field from dequeue responses — leave `pending` count intact.

## Proposed Shape

```ts
// ProfileData (profile-manager.ts)
suppress_pending_hint?: boolean;
```

When `suppress_pending_hint === true` in the active session profile, omit the `"hint"` field from dequeue responses regardless of `pending` count.

## Acceptance Criteria

- [x] `ProfileData` gains `suppress_pending_hint?: boolean`.
- [x] `dequeue.ts` checks the profile flag before appending the hint.
- [x] Flag is set/cleared via the existing `profile/save` mechanism.
- [x] Tests cover: flag absent (hint appears), flag true (hint suppressed), flag false (hint appears).
- [x] help('dequeue') or help('profile') updated to document the flag.

## Verification

APPROVED by verifier a910f216fed6a15e7 — all 5 ACs confirmed, clean worktree (rebased onto 45030df5), test evidence complete (3657/3659 pass, 2 pre-existing ONBOARDING_LOOP_PATTERN failures unrelated to feature).
