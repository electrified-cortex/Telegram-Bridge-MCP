---
created: 2026-06-12
status: draft
priority: 10
type: Bug
agent_type: Worker
repo: electrified-cortex/Telegram-Bridge-MCP
model_class: sonnet-class
reasoning_effort: medium
---

# 10-0012 — Bug: shutdown hangs forever when no participants are active

## Summary

When `action(type: "shutdown")` is invoked (e.g. via `/shutdown` slash command) and there
are no active participant sessions, the shutdown grace period waits indefinitely for
participants to exit — but there are none. The bridge hangs instead of exiting.

## Expected behavior

If there are no active non-governor participant sessions when shutdown is triggered, the
grace period should be skipped entirely and the bridge should proceed to immediate clean exit.

## Reproduction

1. Start bridge with only the governor session active (no workers or other sessions).
2. Send `/shutdown` from Telegram.
3. Bridge enters grace period, emits `shutdown/warn` to participants, waits... forever.

## Acceptance Criteria

1. `/shutdown` with zero active non-governor sessions exits immediately (no grace period wait).
2. `/shutdown` with active participants still emits `shutdown/warn`, waits for `session_closed`
   events or timeout — existing behavior preserved.
3. Shutdown emits the `shutdown` service event and process exits cleanly in both cases.
4. No regression in the normal multi-session shutdown flow.

## Scope boundary

- Fix the grace period / participant wait logic only.
- Do not change the `shutdown/warn` mechanism or the shutdown event schema.

## Notes

- Operator directive 2026-06-12: "if there's no participants and shutdown is invoked... it
  should just shut down immediately."

## Overseer gate

**Reviewer:** Overseer  
**Date:** 2026-06-12  
**Verdict:** PASS

- ACs binary and testable (4 ACs, all verifiable)
- Scope: grace period / participant-wait logic only — bounded
- Delegation: Worker, sonnet-class — correct
- No open questions; operator directive is explicit
- Code confirmed: `shutdown.ts` guards both waits with `hasActiveSessions` but `listSessions()` appears to include the governor session — fix is to exclude non-participant sessions from the `hasActiveSessions` check

## Verification

**Verdict:** APPROVED
**Date:** 2026-06-12
**Merge:** 671eb77d (dev)
**Sealed-By:** foreman/dev 2026-06-12
