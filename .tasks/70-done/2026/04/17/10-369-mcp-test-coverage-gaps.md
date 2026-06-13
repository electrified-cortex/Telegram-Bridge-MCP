---
Created: 2026-04-07
Status: Draft
Host: local
Priority: 10-369
Source: Worker 1 (code review of 10-368)
---

# Add Missing Test Coverage for Cold-Start Regression Fixes (10-368)

## ⚠️ Triage Note (2026-04-14)

May be stale — cold-start flow has been significantly reworked since this was written. Investigate if these specific test gaps still exist before starting. Commit 7f2b2f2 may have been superseded.

## Objective

Add unit tests for the four new behaviors introduced in commit `7f2b2f2`
(task 10-368) that were not covered by the original hotfix commit.

## Context

Commit `7f2b2f2` resolved critical cold-start regressions in the Telegram MCP
`dev` branch. Production code was confirmed correct by code review, but four
distinct new behaviors lack unit-level verification. These were deferred from
10-368 to maintain stability during an autonomous period.

**Repo:** Telegram MCP (this repo) (`dev` branch)

## Missing Tests

### 1. First-session `setGovernorSid` — `session_start.test.ts`

**Current (stale):** Test at line 414 asserts `expect(mocks.setGovernorSid).not.toHaveBeenCalled()`
for a first-session join. This contradicts the fix — the first session MUST call
`setGovernorSid(session.sid)`.

**Required:** Update test to assert `setGovernorSid` IS called with the session's SID
when `isFirstSession` is true. Verify the `_governorSid = 0` falsy guard path is covered.

### 2. `colorHint` fallback in `approve_agent` — `approve_agent.test.ts`

**Current:** No test covers the new fallback path: when `color` is omitted by the approver,
try `pending.colorHint` before falling back to `getAvailableColors()[0]`.

**Required:** Add test case that:
- Sets `pending.colorHint` to a valid color (e.g. `"🟩"`)
- Calls `approve_agent` without a `color` argument
- Asserts the returned/assigned color equals `"🟩"`

### 3. `colorHint` storage in `registerPendingApproval` — `agent-approval.test.ts`

**Current:** Existing test checks `pending.name` and `pending.resolve` but never asserts
`colorHint` is stored correctly.

**Required:** Add test that:
- Calls `registerPendingApproval("AgentX", fn, "🟩")`
- Reads back `getPendingApproval("AgentX")!.colorHint`
- Asserts it equals `"🟩"`
- Also verify `colorHint` is `undefined` when not passed

### 4. Governor `pending_approval` notification — `session_start.test.ts`

**Current:** The block that delivers a `pending_approval` service message to the governor
SID (added in 10-368) has no test.

**Required:** Add test that:
- Sets `getGovernorSid()` mock to return a non-zero SID
- Triggers the approval-wait path
- Asserts `deliverServiceMessage` was called with `event_type: "pending_approval"`
  targeting the governor SID

## Additional Fixes

### 5. Stale hint-ordering test — `session-manager.test.ts:452`

Test description and assertion are inverted relative to the new behavior:
```
it("previously-used hint stays at its natural sorted position, not forced first", ...)
  expect(colors[0]).not.toBe("🟦");  // now incorrect — hint IS forced first
```
Update assertion to `expect(colors[0]).toBe(hint)` and update description.

## Acceptance Criteria

- [ ] All 4 missing tests added and passing
- [ ] Stale hint-ordering test (item 5) updated
- [ ] `pnpm test` — all tests pass
- [ ] `pnpm build` — zero errors
- [ ] `pnpm typecheck` — passes (or pre-existing errors documented if still present)
