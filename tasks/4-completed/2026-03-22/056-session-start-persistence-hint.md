# 056 — session_start: persistence & recovery instructions in API response

## Problem

When context compaction occurs, agents lose their SID and PIN. They then trigger the reconnect approval flow unnecessarily, and miss messages that arrived during the gap. This happens because:

1. No API-level instruction tells agents to persist their credentials.
2. No API-level instruction tells agents to check history after reconnecting.
3. The reconnect response doesn't include the same hints the fresh session response does.

## Solution

Add an `instructions` field to the `session_start` response for both fresh and reconnected sessions. This field should contain concise, imperative text that any LLM agent will follow — telling it to save credentials and recover from gaps.

## Changes

### A. `src/tools/session_start.ts`

Add an `instructions` string to both response paths:

**Fresh session response** — add alongside existing `profile_hint`:

```ts
res.instructions = "IMPORTANT: Save your SID and PIN to session memory NOW. "
  + "You will need them to reconnect after context compaction. "
  + "On reconnect, call get_chat_history to recover any messages missed during the gap.";
```

**Reconnect response** — add to the `toResult` object:

```ts
toResult({
  sid: fullSession.sid,
  pin: fullSession.pin,
  sessions_active: reconSessActive,
  action: "reconnected",
  pending: 0,
  instructions: "You reconnected after a gap. "
    + "Call get_chat_history to check for messages you may have missed. "
    + "Re-save your SID and PIN to session memory if needed.",
})
```

### B. Tests

- Verify fresh session response includes `instructions` field.
- Verify reconnect response includes `instructions` field.
- Verify both instruction strings mention "session memory" and "SID".

### C. `changelog/unreleased.md`

Add under `Added`:
- `session_start` response includes `instructions` field with persistence and recovery guidance

## Acceptance criteria

- [ ] `pnpm build` clean
- [ ] `pnpm test` — all pass
- [ ] `pnpm lint` clean
- [ ] Fresh session response includes `instructions`
- [ ] Reconnect response includes `instructions`

## Files

| File | Action |
|---|---|
| `src/tools/session_start.ts` | Add `instructions` to both response paths |
| `src/tools/session_start.test.ts` | Add tests for instructions field |
| `changelog/unreleased.md` | Document addition |

## Completion

**Date:** 2026-03-22

### Changes made

| File | Change |
|---|---|
| `src/tools/session_start.ts` | Added `instructions` field to fresh session `res` object and to reconnect `toResult(...)` call |
| `src/tools/session_start.test.ts` | Updated two exact-match `toEqual` tests to include `instructions: expect.any(String)`; added 4 new tests covering fresh and reconnect instructions content |
| `changelog/unreleased.md` | Added entry under `Added` |

### Results

- `pnpm build` — clean
- `pnpm test` — 1327 passed (59 test files)
- `pnpm lint` — clean
