# 10-753 — Add first-time-use hint system for bridge features

## Context

When an agent uses a bridge feature for the first time (e.g., `send(type: "choice")`,
`send(type: "progress")`), there is currently no guidance about alternatives or related
features. First-time callers lack context on what they chose vs. what they could have
chosen. This creates friction and incorrect feature selection.

## Problem

An agent may use `send(type: "choice")` (non-blocking) when it needed
`send(type: "question", choose: ...)` (blocking), or vice versa — with no in-product
hint available at the decision point. The first time a feature is used is the highest-
value moment to surface this guidance.

## Proposed Behaviour

1. The bridge tracks first-time usage of each `send` type per session (or across
   sessions via a lightweight flag).
2. On first use of a type, the bridge appends a **one-time hint** to the response:
   - What the feature is for
   - When to prefer the alternative
   - A pointer to the help topic (`help("send")`)
3. Hint is **never shown again** after the first use of that type.
4. Hint format: lightweight footer in the tool response (not a Telegram message).

## Scope

- `send` types minimum: `choice`, `question`, `progress`, `checklist`, `animation`
- Hint content per type defined in a companion task (10-754)
- Session-scoped tracking acceptable for v1 (reset on restart)

## Acceptance Criteria

- [ ] First call to `send(type: "choice")` includes a hint about `question/choose`
- [ ] Hint is NOT shown on the second call to the same type
- [ ] Hint content follows the per-type spec in 10-754
- [ ] No Telegram message is sent — hint lives in the tool response only
- [ ] Covered by at least one integration test per type

## References

- Operator voice directive 2026-04-21 triage session
- Related: 10-754 (per-type hint content), `help("send")`

## Activity Log

- **2026-04-24** — Pipeline started. Variant: Implement only.
- **2026-04-24** — [Stage 4] Implementation dispatched. 4 files changed (first-use-hints.ts, first-use-hints.test.ts, send.ts, send.test.ts). Build passed.
- **2026-04-24** — [Stage 5] Verification: build PASS; lint/test env-only gap (worktree no node_modules) — authorized by Overseer; impl subagent confirmed 2520+22 tests pass in main TMCP dir.
- **2026-04-24** — [Stage 6] Code Reviewer pass 1: 2 major, 2 minor, 1 nit. Re-dispatched impl to fix. Pass 2: 0 major, 2 minor, 2 nit — cleared.
- **2026-04-24** — [Stage 7] Complete. Branch: 10-753, commit: 067807b. Ready for Overseer review.
- **2026-04-24** — NEEDS_REVISION: tutorial infrastructure being removed (10-725). Rework to standalone `firstUseHintsSeen` Set.
- **2026-04-24** — [Revision] refactor(hints): standalone tracking (55b1b94). Code review pass 3: 3 major. Fix pass (376f094). Code review pass 4: clean.

## Completion

Implemented first-time-use hint system for 6 `send` types: choice, question/choose, progress, checklist, animation, append. Per-type hint content from task 10-754 fully incorporated. Revised to be independent of tutorial mode infrastructure.

**What was built:**
- `src/first-use-hints.ts` — hint registry + `getFirstUseHint(sid, key)` + `appendHintToResult(result, hint)` + exported `hasSeenHint` and `markFirstUseHintSeen` for 15-713/15-714. Standalone `firstUseHintsSeen: Set<string>` on session, accessed via `getOrInitHintsSeen`. Hints fire unconditionally for valid sessions.
- `src/session-manager.ts` — added `firstUseHintsSeen?: Set<string>` to Session interface + `getOrInitHintsSeen(sid)` export. TODO(10-725) comments on legacy tutorial fields.
- `src/tools/send.ts` — 6 type branches wrapped with hint injection.
- `src/tools/action.ts` — TODO(10-725) comments on `tutorial/on` and `tutorial/off` handlers noting they are no-ops.
- Tests: first-use-hints.test.ts, session-manager.test.ts, send.test.ts, dequeue.test.ts all updated.

**Subagent passes:** Implementation ×4, Code Reviewer ×4.
**Final review (pass 4):** 0 critical, 0 major, 0 minor, 0 nit — clean.
