# Task 004 — Manual Test Script Rewrite

> **Note:** References to load-balance, cascade, and pass\_message are stale
> (removed in task 200). Phase 3 needs rewriting for governor-only routing.

## Problem

`docs/multi-session-test-script.md` has reply-check (targeted routing) buried
in Phase 2 step 2.2. This is the most critical routing behavior — if replies
don't reach the correct session, nothing else matters. It should be the very
first scenario tested.

## Changes Required

**File:** `docs/multi-session-test-script.md`

Restructure so the test phases are ordered by criticality:

1. **Phase 1 — Targeted Routing (Reply-To)**
   - Two sessions active
   - Session 1 sends a message
   - Operator replies to session 1's message
   - Verify: only session 1 receives it, session 2 does not
   - Repeat for session 2
   - Test callback routing (button press reaches sending session)

2. **Phase 2 — Session Lifecycle**
   - Current Phase 1 content (session start, listing, close)

3. **Phase 3 — Ambiguous Message Routing**
   - Load balance (round-robin)
   - Routing panel appears on 2nd session join
   - Switch to cascade, verify pass_by deadlines
   - Switch to governor, verify delegation

4. **Phase 4+** — DMs, edge cases, stress tests (current Phases 4-7)

## Acceptance Criteria

1. Reply-to routing is Phase 1, step 1
2. All existing test scenarios preserved (just reordered)
3. Passes markdownlint
