---
created: 2026-06-27
status: draft
priority: 10
source: Operator voice TG 80387; split from 10-3062 Gap 6
repo: electrified-cortex/Telegram-Bridge-MCP
type: Defect / Security
severity: high
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# TMCP — Governor Promotion Hard-Block for Child Sessions

**ID**: 10-3064
**Date**: 2026-06-27
**Priority**: High
**Origin**: Operator TG 80387 ("I don't think I should ever give governor access to a sub session. Am I crazy?"); split from 10-3062 Gap 6

## Problem

A child/sub-session must NEVER be promotable to governor under any circumstance. This is a hard trust-model constraint, not a convention. Currently, the governor-promotion handler has no explicit check for `parent_sid` — a child session could theoretically be elevated.

## File & Functions

All changes are in **`src/built-in-commands.ts`**.

There are **two** governor promotion paths that both need the guard:

### Path 1 — `governor:set:` callback (~line 529)

```typescript
if (data.startsWith("governor:set:")) {
  const newSid = parseInt(data.slice("governor:set:".length), 10);
  ...
  const newGovernor = sessions.find(s => s.sid === newSid);
  if (!newGovernor) { ... return; }
  // INSERT GUARD HERE — after newGovernor found, before setGovernorSid
  ...
  setGovernorSid(newSid);  // line ~582
```

### Path 2 — `session:primary:` callback (~line 1413)

```typescript
if (data.startsWith("session:primary:")) {
  const sid = parseInt(data.slice("session:primary:".length), 10);
  ...
  const target = sessions.find(s => s.sid === sid);
  if (!target) { ... return; }
  // INSERT GUARD HERE — after target found, before setGovernorSid
  ...
  setGovernorSid(sid);  // line ~1432
```

## Required Change

In **both** paths, after the session object is found and before `setGovernorSid` is called, add:

```typescript
// CHILD_SESSIONS_CANNOT_BE_GOVERNOR
if ((newGovernor /* or target */).parent_sid !== undefined) {
  // Silently no-op (panel may already be dismissed); or surface error to operator
  return;
}
```

The error string `CHILD_SESSIONS_CANNOT_BE_GOVERNOR` must appear as a comment or in an error message so it is greppable.

**Session field**: `parent_sid` (snake_case, not camelCase) — confirmed in `health-check.ts` line 196: `const isChildSession = session.parent_sid !== undefined;`

### Optional UX: surface the rejection to operator

Rather than a silent no-op, consider editing the panel message to say e.g.:
> "⚠️ Child sessions cannot be set as primary. Close this session and promote a root session."

This is optional but preferred — a silent no-op could confuse the operator.

## Acceptance Criteria

- [ ] **AC1**: `grep -c "CHILD_SESSIONS_CANNOT_BE_GOVERNOR" src/built-in-commands.ts` returns **2** (one per promotion path)
- [ ] **AC2**: `grep -c "parent_sid" src/built-in-commands.ts` returns ≥ 2 (one check per path)
- [ ] **AC3**: Unit test exists for `governor:set:` path: attempting to promote a session with `parent_sid` set does NOT call `setGovernorSid`
- [ ] **AC4**: Unit test exists for `session:primary:` path: attempting to promote a session with `parent_sid` set does NOT call `setGovernorSid`

## No Dependencies

This task is independent of 10-3057, 10-3063, and 10-3065. Can be dispatched immediately after Overseer PASS.

## Delegation

Needs Overseer gate → Worker

## Verification

**Status**: APPROVED  
**Verifier**: ad70beb6529af11d5  
**Date**: 2026-06-28  
**Squash commit**: 2f20d4b  

All 4 ACs confirmed:
- AC1: `CHILD_SESSIONS_CANNOT_BE_GOVERNOR` appears ×2 in `src/built-in-commands.ts` ✓
- AC2: `parent_sid` appears ×4 (≥2) in `src/built-in-commands.ts` ✓
- AC3: Unit test — `governor:set:` path with child session does NOT call `setGovernorSid` ✓
- AC4: Unit test — `session:primary:` path with child session does NOT call `setGovernorSid` ✓

Test gate: 4014/4014 pass, `.temp/test-results.md` present.
