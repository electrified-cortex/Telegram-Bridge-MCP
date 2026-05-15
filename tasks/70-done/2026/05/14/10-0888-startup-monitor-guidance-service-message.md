---
id: "10-0888"
title: "Add explicit monitor-setup service message to startup/onboarding"
type: feature
priority: 20
status: queued
created: 2026-05-07
filed-by: Overseer (operator-approved)
delegation: Worker
target_repo: telegram-bridge-mcp
target_branch: release/7.4
---

# Add explicit monitor-setup service message to startup/onboarding

## Goal

Send a service message early in session startup (or on first dequeue) that tells
Monitor-capable agents exactly how to wire up the activity-file watcher. Be explicit
and simple — agents tend to over-engineer it.

## Why

Agents write complex bash scripts, call `activity/file/edit` to "test" (which rotates
the path), duplicate monitors — all unnecessary. The correct monitor is one line.

## What the message should say

Exact wording is Curator's call, but the **required content** is:

> If you have a Monitor tool: when the activity file's mtime changes, emit one line —
> e.g. `echo "call dequeue(TOKEN)"`. That's the entire monitor. Do nothing else.

Key constraints:
- Be **explicit** — show the one-liner, don't describe it abstractly.
- `TOKEN` = the agent's actual session token, baked in at monitor-start time.
- Do NOT call `activity/file/edit` to test — that rotates the path.
- The monitor survives compaction; don't recreate if it has already fired.

## Trigger

Operator preference: startup or first dequeue after `activity/file/create`.
Whichever fires earliest for a new session is correct. Avoid sending it on every
session start to a long-running agent that already has a monitor wired.

## Relation to 10-0880

10-0880 updates `onboarding_loop_pattern` with runtime-conditional guidance and
concrete examples. This task is the **explicit simplicity signal** — the message
must show the one-liner and emphasize "that's it, nothing more." 10-0880 may
address this if its concrete examples are explicit enough; if so, close this task
as covered-by-10-0880.

## Acceptance criteria

- [ ] A service message is sent to Monitor-capable sessions explaining the one-liner pattern.
- [ ] Message shows the literal `echo "call dequeue(TOKEN)"` form (bash) or equivalent.
- [ ] Message notes: don't call `activity/file/edit` to test.
- [ ] Message is ≤ 4 sentences / 5 bullets — no walls of text.
- [ ] Verified: new Claude Code session receives the message before or on first dequeue.

## Operator framing

Msgs 51118–51122, 2026-05-07: "The monitor should just say 'call dequeue(token)'. That's it.
Whether bash or PowerShell, it doesn't have to be fancy. Be explicit about how simple it is."

## Completion

**Sealed:** 2026-05-07
**Shipped:** PR #168 — TMCP v7.4.1 (squash-merged to master `ab1d4139`)
**Squash commit:** `04271505` (on release/7.4)
**Verdict:** APPROVED
**Sealed by:** Overseer (Worker dispatch)

## Verification (pass 1 — NEEDS_REVISION)

**Verified:** 2026-05-14
**Verdict:** NEEDS_REVISION
**Verifier:** Foreman (task-verification sub-agent, fresh-eyes pass)
**Gaps:** AC2 (no literal one-liner in service message) and AC3 (no activity/file/edit warning) were unmet.

---

**Revision:** 2026-05-14
**Branch:** `feat/10-0888-monitor-oneliner-fix`
**Commit:** `c37b305e`
**Addressed:**
- AC2: Added literal `` `echo "call dequeue(TOKEN)"` `` one-liner to `ONBOARDING_LOOP_PATTERN` bullet 2 with note to bake in token at start time.
- AC3: Added bullet 3 — "Do NOT call activity/file/edit to test — it rotates the path."
**Tests:** 3013/3013 passed (`pnpm test`)

## Verification (pass 2 — APPROVED)

**Verified:** 2026-05-14
**Verdict:** APPROVED
**Verifier:** Foreman (task-verification sub-agent, fresh-eyes pass)
**Evidence:** All 5 AC confirmed. AC2 — `service-messages.ts:51`: `` `echo "call dequeue(TOKEN)"` — bake in your token, that's the entire monitor. `` AC3 — `service-messages.ts:52`: `Do NOT call activity/file/edit to test — it rotates the path.` AC1/AC4/AC5 confirmed via prior pass. 3013 tests pass.
