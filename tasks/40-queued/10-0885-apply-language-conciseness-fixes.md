---
id: "10-0885"
title: "FIX: Apply language-conciseness audit findings (10-0884 follow-up)"
type: task
priority: 10
status: queued
created: 2026-05-06
filed-by: Curator
delegation: Worker
target_repo: telegram-bridge-mcp
target_branch: release/7.4
---

# Apply 10-0884 Language Audit Findings

## Background

10-0884 produced `audit/language-conciseness.md` with 18 findings (6 High, 9 Medium, 3 Low) covering service messages, hints, help topics, and tool descriptions. Curator reviewed — all 18 are valid.

Operator directive 5/6: get as much as we can land into release/7.4 before public PR cuts.

## Scope

Apply the audit's "Suggested Rewrite" column to each of the 18 findings. The audit table is the spec.

## Caveats

Two items have prior commits on release/7.4 — reconcile, don't duplicate:

- **Item #6** (`docs/help/start.md` activity-file watcher block) — service-message variant already tightened in `feat(10-0880): tighten onboarding_loop_pattern phrasing` (commit 7f379336). The docs/help/start.md block itself is still untouched and IS in scope. Apply audit's rewrite.

- **Item #15** (`src/tools/session/start.ts` DESCRIPTION) — already partially shortened in `feat(10-0880): trim session/start response to {token, sid, hint}` (commit 5b617693). Current text: `"Call once at the start of every session. Creates a fresh session with a unique ID and token. Fresh sessions auto-drain pending messages. If you lost your token (context loss, crash), use action(type: 'session/reconnect', ...) instead. Returns { token, sid, hint } — call dequeue(token) next to enter the loop."` — Compare to audit's suggested rewrite. If audit's is tighter, apply. Otherwise leave.

## Out of scope

- `ONBOARDING_LOOP_PATTERN` (already approved + shipped — excluded by audit)
- Test-language asserts (separate task 10-0882)
- Behavioral changes — text only

## Acceptance Criteria

- [ ] Each High-priority finding (6 items) applied verbatim from audit's "Suggested Rewrite" column, OR with tighter variant if Worker can argue it
- [ ] Each Medium-priority finding (9 items) applied
- [ ] Each Low-priority finding (3 items) applied
- [ ] Items #6 and #15 reconciled per Caveats section above
- [ ] Tests updated where literal-string assertions break (acknowledged: many will — operator allows test churn here, but log which assertions you touched)
- [ ] No new tests added that assert on literal copy strings — pair that audit lands separately (10-0882, 10-1xxx for prevention rule)
- [ ] Single commit (or one commit per priority tier — your call) with body referencing 10-0884 audit findings table
- [ ] All work direct on `release/7.4` — operator wants this in the public PR

## Bailout

- 90 min cap.
- If any rewrite would change a tool's response shape (not just text), surface back instead of applying.
- If a test failure is structural (not just literal string), surface back rather than rewriting.

## Branch

Direct on `release/7.4` (no feature branch — operator authorized 7.4 landings).

## Priority

P10 — release/7.4 ship gate. Operator's directive: "as much as we can get into release/7.4."
