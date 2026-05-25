---
type: prd
status: draft
version: 1.0
filed-by: Curator
filed-date: 2026-05-17
last-revised: 2026-05-17
priority: P2
origin: operator voice 2026-05-17T~15:20Z
related:
  - tasks/00-ideas/15-802-silence-detector-counts-agent-outbound.md
  - tasks/00-ideas/smart-service-message-injection-2026-05-17.md (paired feature, parked)
---

# Smart-debounce kick timing

Replace the per-session pre-kick debounce floor with a post-kick lockout, released by content-returning `dequeue` exits.

## Problem

The bridge gates kicks (activity-file touches) via a per-session debounce floor of 60s (configurable 1-600s via `profile/kick-debounce`). Two pain points:

1. **First-message latency.** A cold agent waits up to 60s for the first kick because the global floor applies unconditionally. The right behavior for a fully-idle agent is *instant* kick.
2. **Redundant retries when the agent hasn't yet dequeued.** Once the agent has been kicked, additional kicks add noise without signal — the agent already knows there's work waiting.

## Solution

Per-session post-kick lockout:

- When an inbound message arrives, if the session is NOT currently locked out: touch the activity file (kick), then lock out further kicks for `LOCKOUT_MS` (default 5 minutes).
- When the session is locked out, inbound messages enqueue silently — no kick.
- When the agent calls `dequeue` and receives at least one event (content-returning exit), the lockout is released. If a message arrived during the lockout but was suppressed, a single re-evaluation kick fires immediately after release.
- `dequeue` calls that return without content (timeout) do NOT release the lockout — the agent didn't actually see anything.
- If the lockout expires (`LOCKOUT_MS` elapsed since the kick) and the agent never dequeued, the next inbound fires a fresh kick. A wedged agent thus gets at most one notification per `LOCKOUT_MS`.

That's the whole mechanism. One timer, two transitions (kick sets it, dequeue clears it), plus the bounded retry on stale lockout.

### Classification

Not every queued event should trigger a kick. The gate decides per-event:

| Source | Kicks? |
|--------|--------|
| Operator message (any modality) | yes |
| Reminder fire | yes |
| Approval ticket (for the calling agent or for the governor) | yes |
| Service message delivered DURING the session's active dequeue | no — agent is reading |
| Service message to an idle session | yes |
| Bridge-internal housekeeping | no |

Classification is a property of the event, not the session — every enqueue site stamps the event with what's needed to classify it.

### Suppressed-during-lockout re-evaluation

If a kick was suppressed during the lockout window, the lockout-release path must fire one re-evaluation kick when it clears. Otherwise a suppressed message could sit silently until the next unrelated inbound or the next `LOCKOUT_MS` expiry. Whether this is implemented as a flag, a queue scan, or a version counter is the implementer's call — the *requirement* is that no suppressed kickable event sits forgotten after the lockout clears.

### Touch failure

If the activity-file write fails, the lockout must NOT be set (otherwise a 5-minute silent gap follows a failed touch). Implementer decides retry policy; a bounded retry (e.g. ~6s total) before giving up is recommended.

## Behavior

- **Cold start.** First operator message: kick within an MCP round-trip.
- **Burst.** N messages within `LOCKOUT_MS` of a kick with no dequeue between: 1 kick total. All N delivered on the agent's next dequeue.
- **Post-content-DQ snap.** Agent dequeues with content. Operator immediately sends. Next inbound kicks within an MCP round-trip.
- **Polling agent.** Agent loops `dequeue(max_wait: 30s)` with no content arriving. Timeout exits do nothing to the lockout. If lockout is active and a message arrives, it enqueues silently; once a content-returning dequeue runs, lockout clears and the re-evaluation kick fires.
- **Stale lockout self-resolves.** Wedged agent (kicked but never dequeues): after `LOCKOUT_MS` expires, the next inbound fires another kick. Repeats at most once per `LOCKOUT_MS`.
- **In-flight dequeue.** Agent blocked in dequeue. Operator sends. Existing in-flight suppression delivers inline; no kick needed.

## Lifecycle

| Event | Effect |
|-------|--------|
| Session create | No lockout |
| Session reconnect | Reset (old agent gone; new one needs a kick on next inbound) |
| Session eviction / GC | Implicit reset via map delete |
| Bridge restart | All sessions reset |
| Stop hook | Reset |

In-memory state only; persistence across bridge restarts is out of scope.

## Acceptance criteria

Wall-clock from bridge ingress to activity-file mtime change.

1. **Cold-start kick.** Fresh session, one operator message. Mtime changes within 1s (2s with antivirus active on Windows).
2. **Burst single-kick.** 10 messages in 30s with no dequeue. Exactly one mtime change in the first 5 minutes.
3. **Stale-lockout safety net.** After AC #2, no dequeue. After 5 min + tolerance, send one more message. Exactly one additional mtime change.
4. **Post-content-DQ snap.** Agent dequeues with content. Operator sends. Mtime changes within 1s (2s with AV).
5. **Suppressed-during-lockout re-evaluation.** Kick fires for M1. M2 arrives during lockout (no extra kick). Agent dequeues, receives M1. M2 remains queued. After dequeue exit, a re-evaluation kick fires. (If production dequeue drains M2 alongside M1, AC #5 instead verifies that no spurious kick fires after the drain.)
6. **Polling agent doesn't break lockout.** Agent loops `dequeue(max_wait: 30s)` with no content. Operator sends mid-lockout. No additional kick until lockout expires or a content-returning dequeue runs.
7. **In-flight dequeue.** Agent blocked in dequeue. Operator sends. Message returns inline; zero mtime changes during that window.
8. **Touch failure rollback.** Mock the activity-file write to fail. Lockout is NOT set. Next inbound retries.
9. **Source classification.** Service message delivered while session is in active dequeue: zero mtime change. Reminder to an idle session: mtime change.
10. **Reconnect resets state.** `session/reconnect` mid-lockout: lockout clears. Next inbound triggers immediate kick.

## Migration

`profile/kick-debounce` had pre-kick-floor semantics (1-600s, default 60s). The new gate has post-kick-lockout semantics (1-3600s, default 300s). Behavior shift requires explicit migration:

1. Add new action `profile/kick-lockout` — canonical knob going forward.
2. `profile/kick-debounce` deprecated, with translation: the numeric value the operator set is preserved as the new `LOCKOUT_MS` (literal translation, no minimum floor). Response includes a deprecation field naming the replacement action and the translated value so callers see it.
3. Surface deprecation to the operator's session via service message.
4. After one release cycle, `profile/kick-debounce` returns a structured error pointing to `profile/kick-lockout`.

Rename the underlying module (`kick-debounce` → `kick-lockout`) in the same PR.

## Open design choice

**Reminder cadence vs lockout.** Reminders are subject to the same lockout. A 1-min recurring reminder behind a 5-min lockout fires once per 5min — acceptable for most reminders; inadequate for time-critical ones. If operator wants per-fire wakes for some reminders, a `lockout_exempt: true` flag on `reminder/set` is a follow-up task; not in v1.

## Implementer notes (advisory; not requirements)

- The kick gate lives in `src/tools/activity/file-state.ts` near the existing `touchActivityFile` logic.
- Every enqueue path must route through the gate; grep for `q.enqueue` and direct `touchActivityFile` callers in `src/session-queue.ts` to find them.
- The lockout-clear hook attaches at `dequeue` exit alongside `setDequeueActive(sid, false)`, but only on content-returning paths (skip timeout exits).
- `appendNewline` currently swallows `ENOENT` retry failures silently; refactor to surface terminal failures so the gate can roll back the lockout.
- Existing fields `lastTouchAt` / `nudgeArmed` are consumed by `shouldPoke` and `handleSessionStopped`; field-survival is a decision the implementer makes in the first commit (keep for legacy callsites OR remove and rewrite consumers).

## Swarm history

| Round | Verdict | Notes |
|-------|---------|-------|
| 1 (v0.3) | NEEDS-REVISION | 5C / 6O, all addressed in v0.4 |
| 2 (v0.4) | NEEDS-REVISION | 3C / 6O, all addressed in v0.5 |
| 3 (v0.5) | NEEDS-REVISION | Mechanism-level fixes addressed in v0.6 |
| 4 (v0.6) | NEEDS-REVISION | Mechanism-level fixes addressed in v0.7 |
| v0.7 → v1.0 | (no swarm) | Operator-directed trim: spec was over-reaching into implementation. v1.0 is the requirements-level surface; mechanism choices delegated to implementer PR per Curator-Overseer-Worker division of labor. |

This PRD is intentionally requirements-shaped. Mechanism details (pseudocode, internal function names, retry timer placement, atomicity proofs) belong in the worker's implementation PR and the code review.

---

# Appendix A — Implementation reference (advisory, not part of the spec)

The material below was produced during spec iteration (v0.3 through v0.7) and four swarm-review rounds. It is NOT requirements; it is context the implementer may find useful when writing the PR. The spec proper ends at "Swarm history" above; everything here is an exploration sketch.

## A.1 — Possible state shape

A reasonable per-session state record for the gate:

```
KickGateState:
    kickLockedUntil: number | null       # UTC ms; null = no lockout
    kickPendingBecauseLocked: bool       # a kickable inbound was suppressed during lockout
    touchInFlight: bool                  # appendNewline is in flight or retry scheduled
    pendingRetryHandle: Timeout | null   # setTimeout handle for next retry
```

## A.2 — Possible kick-gate sketch

```
async kickIfAllowed(sid, event):
    if classify(event) == 'no-kick': return
    state = gateState[sid]
    # Synchronous reservation BEFORE await — JS single-threadedness makes
    # this atomic; no mutex required.
    if state.touchInFlight:
        state.kickPendingBecauseLocked = true
        return
    if state.kickLockedUntil is not null AND state.kickLockedUntil > now:
        state.kickPendingBecauseLocked = true
        return
    state.touchInFlight = true
    state.kickLockedUntil = now + LOCKOUT_MS
    state.kickPendingBecauseLocked = false
    try:
        ok = await touch_activity_file(sid)
    finally:
        state.touchInFlight = false
    if not ok:
        state.kickLockedUntil = null
        scheduleRetry(sid)

releaseKickLockout(sid, reason):
    state = gateState[sid]
    if state.kickLockedUntil is null AND not state.kickPendingBecauseLocked: return
    pending = state.kickPendingBecauseLocked
    state.kickLockedUntil = null
    state.kickPendingBecauseLocked = false
    if pending AND queueHasPending(sid):
        fireRevaluationKick(sid)
```

`fireRevaluationKick` is a direct touch path that doesn't re-enter `kickIfAllowed` (no classification, never declines).

## A.3 — Classification table (pure over event)

| source | inflightDequeueAtEnqueue | result |
|--------|--------------------------|--------|
| operator | * | kick |
| reminder | * | kick |
| approval-self | * | kick |
| approval-governor | * | kick |
| service | true | no-kick |
| service | false | kick |
| bridge-internal | * | no-kick |

`classify` reads only fields on the event argument. Each enqueue site stamps `source` and (for service messages) `inflightDequeueAtEnqueue` at enqueue time.

## A.4 — Concurrency note

`kickIfAllowed` is async because the touch call is async. The check-and-set portion above the `await` is synchronous. In Node.js, a synchronous code block runs to completion before any other microtask executes — including any other call to `kickIfAllowed` on the same `sid`. Two near-simultaneous HTTP handlers run their sync preludes serially; the second observes the first's reservation. No mutex required.

## A.5 — Enqueue call sites (verified at v0.7 against HEAD; re-verify in implementation PR)

These are the `q.enqueue` and routing sites in `src/session-queue.ts` that today either call `touchActivityFile` directly or feed paths that eventually do. All of them should route through the gate:

- `:203` (broadcast loop within `routeToSession`)
- `:226-236` (`enqueueToSession`, primary path)
- `:371` (`deliverAsyncSendCallback`)
- `:398` (`deliverDirectMessage`)
- `:471` (`deliverServiceMessage`) — stamps `inflightDequeueAtEnqueue`
- `:508` (`deliverReminderEvent`)
- `:531` (`routeMessage`)

## A.6 — Clear-hook call sites in `src/tools/dequeue.ts`

Lockout-clear pairs with `setDequeueActive(sid, false)` at content-returning exits only. Skip timeout-exit paths.

Content-returning exits (clear lockout):
- `:233` (immediate-batch return)
- `:341-348` (other content-returning exits)
- `:361` (`runDrainLoop` finally — content-returning path)

Skip:
- `:241` (timeout-only return)
- `:354-362` (timeout-path finally)

## A.7 — Eviction / replace paths in `src/tools/activity/file-state.ts`

`clearActivityFile` (`:226-245`) and `replaceActivityFile` (`:269-273`) mutate the per-session record. If `KickGateState` lives on the activity entry, both must `clearTimeout(state.pendingRetryHandle)` before mutating. `replaceActivityFile` decides whether to carry over kick state (default: carry over) or reset.

## A.8 — Retry policy sketch

`scheduleRetry`:
- First failure → setTimeout 1s → on fire, retry the touch if queue still has pending
- Second failure → setTimeout 5s → same
- Third failure → log; clear handle; give up. Next inbound retries fresh.

Retry handle stored on `KickGateState`. All reset paths (reconnect, Stop, GC, replace) `clearTimeout` before mutating.

## A.9 — `queueHasPending(sid)` shape

A register-provider pattern keeps the gate decoupled from individual queue modules:

```
gate.registerPendingProvider(name, providerFn: (sid) => bool)
```

Each queue module registers a provider at init. `queueHasPending(sid)` ORs across registered providers. Adding a queue = compile-time obligation to register, not a doc-comment obligation.

## A.10 — Implementer caveats from review rounds

- `appendNewline` (file-state.ts:156-175) currently swallows `ENOENT` retry failures silently. Refactor to return a success boolean so the gate can roll back the lockout on failure.
- `shouldPoke` (file-state.ts:193-201) reads `lastTouchAt`. `handleSessionStopped` (file-state.ts:419+) reads `nudgeArmed`. Field-survival decision (Option A: keep them for legacy consumers; Option B: remove and rewrite) must be made in the first commit.
- Existing direct `touchActivityFile` callers outside the gate module must be migrated or deleted in the same PR — no transitional period with both paths firing.
- `AC #5` test mechanics: existing `dequeueBatch` semantics return "response lane + 1 content event" (see `session-queue.test.ts:218`). Use that semantics in the test rather than inventing a `batch_size` parameter.

## A.11 — Migration mechanics

- `profile/kick-debounce` deprecation response shape: `{ ok: true, deprecated: true, replacement: 'profile/kick-lockout', translated_value: <legacy_value> }`.
- Translation: `LOCKOUT_MS = legacy_value_seconds * 1000` (literal; no floor).
- Operator-facing service message surfaces the deprecation; may itself be subject to the lockout if the session is in-flight (accepted — response field is primary disclosure).
- Module rename `kick-debounce.ts` → `kick-lockout.ts` in the same PR.

---

End of appendix.

---

## Overseer review

**Reviewer:** Overseer
**Date:** 2026-05-17
**Verdict:** PASS — ready for implementation

**Review type:** adversarial-manual

**Checked:**
- Acceptance criteria are binary and testable (10 ACs, wall-clock measurable, Windows-aware tolerances)
- AC5 branching condition is intentional and explained; both paths have clear verification semantics
- Scope is clear and bounded: one PR scope, same-PR constraint stated, out-of-scope explicit
- Open design choice (reminder lockout exemption) explicitly parked as follow-up — not blocking
- Migration plan complete: action rename, deprecation response shape, translation rule, sunset path
- Classification table complete: all event sources covered
- No critical open questions

**Not checked:**
- Technical correctness of the advisory appendix (mechanism sketches, pseudocode, call-site line numbers) — implementer re-verifies against HEAD in the PR
- Whether `appendNewline` refactor (AC8 prerequisite) is safe given current callers — worker assesses in implementation

**Next:** Task filed to `40-queued/` for TMCP worker assignment.
