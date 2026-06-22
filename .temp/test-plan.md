# Test Plan — 10-2100: Child Lifecycle Notification Gaps

## Scope

Fix two child lifecycle notification gaps:
- **Gap 1 (AC1):** Cascade teardown emits `child_session_resolved` to parent's dequeue.
- **Gap 2 (AC2):** Health-check inactivity detection emits `child_session_stale` to parent's dequeue.

---

## Acceptance Criteria → Test File Mapping

| AC | Description | Test File | Describe Block |
|----|-------------|-----------|----------------|
| AC1 | Cascade teardown emits `child_session_resolved` to parent dequeue | `src/session-teardown.test.ts` | `"session-teardown: cascade close emits child_session_resolved (AC1)"` (line 291) |
| AC2 | Health-check inactivity emits `child_session_stale` to parent dequeue | `src/health-check.test.ts` | `"AC2: child session stale — emits child_session_stale to parent dequeue"` (line 877) |
| AC2 | Child session recovery suppresses operator Telegram back-online | `src/health-check.test.ts` | `"AC2: child session recovery — suppresses operator Telegram back-online"` (line 978) |
| AC3 | Events carry only lifecycle metadata (no message content/routing) | Verified by AC1/AC2 payload assertions — only `child_sid`, `child_name`, `exit_status`/`last_active_at` in payloads |
| AC4 | Unit tests cover cascade-close and stale-child paths | `src/session-teardown.test.ts` + `src/health-check.test.ts` (13 new tests total) |
| AC5 | Both event types documented in service-messages constants | `src/service-messages.ts` — `CHILD_SESSION_RESOLVED` (line 511) + `CHILD_SESSION_STALE` (line 525) |

---

## Test Commands

```bash
# Build
pnpm build
# => tsc && node scripts/gen-build-info.mjs

# Lint
pnpm lint
# => eslint src

# Tests
pnpm test
# => vitest run
```

---

## Pass/Fail Summary

| Command | Result |
|---------|--------|
| `pnpm build` | **PASS** — `build-info: commit=83e4a437` |
| `pnpm lint` | **PASS** — no output (no errors) |
| `pnpm test` | **PASS — 3940/3940 tests** across 162 test files |

> Note: `src/tools/dequeue.test.ts` has 5 pre-existing TypeScript type errors on `suppress_pending_hint` visible under `tsc --noEmit`. These exist on the branch before any 10-2100 changes (confirmed by `git stash` + rerun). `vitest run` itself passes for all 3940 tests.

---

## New Tests Added (13 total)

### `src/session-teardown.test.ts` — AC1 cascade close (6 tests)

Describe block: `"session-teardown: cascade close emits child_session_resolved (AC1)"`

1. `AC1: emits child_session_resolved to parent for each child in cascade`
2. `AC1: payload uses empty exit_status when child has no exit_status field`
3. `AC1: no emission when child session is not found (already closed)`
4. `AC1: emits for each child when parent has multiple children`
5. `AC1: emits child_session_resolved BEFORE closing child session (call ordering)`
6. `AC1: does not emit child_session_resolved for sessions without children`

### `src/health-check.test.ts` — AC2 stale child (5 tests)

Describe block: `"AC2: child session stale — emits child_session_stale to parent dequeue"`

7. `AC2a: emits child_session_stale to parent dequeue via deliverServiceMessage`
8. `AC2b: payload contains last_active_at derived from lastPollAt`
9. `AC2c: does NOT call sendServiceMessage for child sessions (no operator Telegram)`
10. `AC2d: root non-governor sessions still use operator Telegram (no regression)`
11. `AC2e: last_active_at falls back to createdAt when lastPollAt is undefined`

### `src/health-check.test.ts` — AC2 recovery suppression (2 tests)

Describe block: `"AC2: child session recovery — suppresses operator Telegram back-online"`

12. `suppresses Telegram back-online for child sessions on recovery`
13. `still sends Telegram back-online for root sessions on recovery (no regression)`

---

## Files Modified

| File | Change |
|------|--------|
| `src/session-teardown.ts` | Cascade loop emits `child_session_resolved` to parent dequeue (Gap 1 fix) |
| `src/health-check.ts` | Stale child emits `child_session_stale` to parent dequeue; recovery suppresses operator Telegram for child sessions (Gap 2 fix) |
| `src/service-messages.ts` | Added `CHILD_SESSION_STALE` entry with `eventType`, `schema`, and `format` (AC5) |
| `src/session-teardown.test.ts` | 6 new AC1 tests |
| `src/health-check.test.ts` | 7 new AC2 tests |
