# 10-3081 — Feature verification: profile ID round-trip (deferred)

**Date:** 2026-06-29
**Source:** Feature triage session, operator deferred (msg 82085) — token budget
**Repo:** electrified-cortex/Telegram-Bridge-MCP
**Feature:** Profile ID (from PR #254, task 10-3074 or related)

## What to verify

When an agent loads its profile via `action(type: 'profile/load', key: '<name>')`, reminder IDs and profile settings should survive across:
1. Agent reconnect (new session, same profile key)
2. Agent compaction + recovery
3. Bridge restart (if reminders are persisted)

Expected: reminders armed during session A continue to fire in session B after profile/load.
Expected: no duplicate reminder fires on reconnect.
Expected: reminder IDs returned by profile/load are stable across sessions.

## Test plan

- [ ] Agent A: profile/load, arm 2 reminders, record their IDs
- [ ] Agent A: compaction or session close
- [ ] Agent B: profile/load with same key, verify reminder IDs match
- [ ] Wait for reminder fire — confirm it arrives in Agent B's dequeue, not orphaned
- [ ] Verify no duplicate fire in overlapping window

## Notes

- Deferred to next week (token budget)
- Only testable by an agent, not the operator directly
- Priority: MEDIUM (feature verification, not P0)
