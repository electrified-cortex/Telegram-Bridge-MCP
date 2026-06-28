---
created: 2026-06-28
status: draft
priority: 20
source: TMCP V8 quality audit swarm wave 2, 2026-06-28
repo: electrified-cortex/Telegram-Bridge-MCP
type: TechDebt
severity: low
dimension: Resource cleanup / correctness
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# TMCP Overhaul: Missing clearOnceOnSend in session teardown (narrow gap, low impact)

**ID**: 30-9103
**Date**: 2026-06-28
**Dimension**: Resource cleanup / correctness
**File**: `D:/Users/essence/Development/cortex.lan/electrified-cortex/Telegram-Bridge-MCP/src/session-teardown.ts`

## Problem

The finding identifies a real but narrow gap: if a session is flagged unresponsive, recovers (clearing it from `_flaggedSids`), gets a "back-online" notifier registered via `registerOnceOnSend`, and then closes normally before sending any message, the notifier entry is never removed from `_sendNotifiers`. The health-check cleanup at line 190 of health-check.ts only fires when the session is still in `_flaggedSids` at the time of the check, which is not the case after a recovery. The entry persists until process shutdown, at which point `stopHealthCheck()` calls `clearOnceOnSend()` and clears everything.

However, two of the three claims in the original finding are wrong or already mitigated:

1. "Large object closure capture" — false. The actual registered closure (health-check.ts line 229) captures only `sid` (a primitive number) and references module-level Maps and functions by name. No session context, no message objects, nothing substantial.

2. "Silent overwrite" — already handled. Line 216 of health-check.ts explicitly calls `clearOnceOnSend(sid)` before registering a new notifier at line 229.

The real gap is a missing one-liner in session teardown for a rare event sequence. Memory impact is negligible (one closure entry per session that hit the specific recovery-then-close path).

## Offending Code

```typescript
// session-teardown.ts — no call to clearOnceOnSend(sid) anywhere in closeSessionById()
```

## Fix

In session-teardown.ts, add to the import from outbound-proxy.js: `clearOnceOnSend`, then add `clearOnceOnSend(sid);` near line 105 alongside `cancelAnimation`. No architectural changes required.

## Verification Notes

Confirmed at low severity, not high. The gap is real and the fix is trivially cheap (one-liner using an already-exported API). However, the original "high" severity rating is unjustified: the closure is trivially small, the overwrite concern is already mitigated at the call site, the accumulation is bounded by the small session count, and the leak resolves automatically on process restart via stopHealthCheck(). A developer should note this during routine maintenance but it does not warrant priority attention.

## Acceptance Criteria

- [ ] Issue resolved per fix description
- [ ] `tsc --noEmit` passes
- [ ] All pre-existing tests pass

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-28
- Verdict: PASS — ACs binary and testable, scope bounded (single targeted fix per file), delegation correct (Worker/Curator), self-contained fix with explicit location. PASS.

## Verification

- Verifier: a43ff25de80e5e324
- Date: 2026-06-27
- Verdict: APPROVED — clearOnceOnSend(sid) import and call confirmed in src/session-teardown.ts closeSessionById(). tsc clean. 4005/4005 tests pass.
- Sealed-By: Foreman, squash commit 5d2bebd8c9f29d57f7abc3bfb72614c07fea8b03, tests 4005/4005
