---
type: task
status: done
filed-by: Overseer
filed-date: 2026-05-17
priority: P2
delegation: TMCP-worker
spec: tasks/10-drafts/activity-aware-kick-timing-2026-05-17.md
---

# Implement smart-debounce kick lockout

Replace per-session kick-debounce floor with post-kick lockout released by content-returning dequeue.

## Spec

See `tasks/10-drafts/activity-aware-kick-timing-2026-05-17.md` (Overseer-gated, PASS 2026-05-17). Requirements section ends at "Swarm history." Appendix A is advisory only.

## Scope (one PR)

1. **Kick gate** — new `KickGateState` per session in `src/tools/activity/file-state.ts`. All `q.enqueue` + `touchActivityFile` call sites in `src/session-queue.ts` route through the gate. Classification stamps `source` + `inflightDequeueAtEnqueue` at enqueue time.
2. **Lockout-clear hook** — attaches at content-returning `dequeue` exits (`src/tools/dequeue.ts`). Timeout exits skip.
3. **Re-evaluation kick** — if a kickable event was suppressed during lockout, fire one kick when lockout clears (if queue still has pending).
4. **Touch-failure rollback** — if activity-file write fails, do NOT set lockout. Bounded retry (see spec A.8).
5. **Migration** — add `profile/kick-lockout` action. Deprecate `profile/kick-debounce` with translation response (see spec migration section). Module rename `kick-debounce.ts` → `kick-lockout.ts` in same PR.
6. **Tests** — cover ACs 1-10 from the spec.

## Acceptance criteria

All 10 ACs in the spec must pass. See spec for exact definitions and timing tolerances.

## Out of scope

- Persistence across bridge restarts
- `lockout_exempt` flag on reminders (follow-up)

## Verification

- **Verdict:** APPROVED
- **Date:** 2026-05-17
- **Verifier:** task-verification dispatch (round 2)
- **Commit:** `c66eaae0` (squash-merged onto `dev` from `worker/impl-kick-lockout`)
- **Test results:** 3116/3116 passed, 141 test files, exit 0
- **All 10 ACs confirmed** with citations to `file-state.test.ts` and source lines in `file-state.ts`, `dequeue.ts`, `session-queue.ts`, `kick-lockout.ts`, `session/start.ts`
