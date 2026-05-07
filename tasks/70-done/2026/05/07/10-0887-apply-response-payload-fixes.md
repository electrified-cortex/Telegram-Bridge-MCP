---
id: "10-0887"
title: "FIX: Apply response-payload audit findings (10-0886 follow-up)"
type: task
priority: 10
status: queued
created: 2026-05-06
filed-by: Curator
delegation: Worker
target_repo: telegram-bridge-mcp
target_branch: release/7.4
---

# Apply 10-0886 Response Payload Audit Findings

## Background

10-0886 produced `audit/response-payload.md` with 20 findings (5 High, 7 Medium, 3 Low) covering always-true booleans, empty `{}` returns, echo-back fields, and redundant wrappers. Estimated payload reduction: 15-20% across typical agent workflows. Curator reviewed — all 20 are valid.

Operator directive 5/6: "as much as we can in 7.4." This is the response-shape pass; pairs with 10-0885 (text/copy pass).

## Scope

Apply the audit's "Suggested Fix" column to each of the 20 findings. The audit table is the spec.

## Caveats

- **Item #5** (`split: true` in send text mode) — verify `split_count` is unconditionally present in the response shape before removing the boolean. If `split_count` is conditional, retain split-detection signal somehow (or expose `split_count: 1` for single-message case).
- **Items #18 / #19** (activity/get registered state, message/pin shape unification) — design decisions, not pure mechanical edits. If you're unsure, surface back; otherwise apply.

## Out of scope

- `hint:` fields — out of scope per audit notes; covered by 10-0885.
- `dequeue.updates` payload — core, not noise.
- Error response shapes.

## Acceptance Criteria

- [ ] All 5 High-priority fixes applied (send.sent/split, empty returns, dequeue.empty, approve.approved, show-typing.started/timeout_seconds)
- [ ] All 7 Medium-priority fixes applied
- [ ] All 3 Low-priority fixes applied (or surfaced back if design call needed)
- [ ] Tests updated where shape changes break literal-value assertions; operator allows test churn but log which assertions you touched
- [ ] Single commit per priority tier acceptable (or one commit total — your call) referencing 10-0886 audit findings table
- [ ] Direct on `release/7.4`

## Bailout / presence

- No fixed time cap. Most fixes are sub-minute edits.
- At 5 min in: send a brief "still working" status message.
- Every 5 min after that: status message including why it's taking longer.
- Always maintain a visible checklist for progress.
- Any fix that would require changing public-API contract beyond removing a field (e.g., renaming, restructuring) — surface back.
- Any consumer in src/ (not tests) that relies on a removed field — surface back.

## Branch

Direct on `release/7.4`.

## Priority

P10 — release/7.4 ship gate.

## Completion

**Sealed:** 2026-05-07
**Shipped:** PR #168 — TMCP v7.4.1 (squash-merged to master `ab1d4139`)
**Squash commit:** shipped in PR #168 batch alongside 10-0867/0880/0881/0888
**Verdict:** APPROVED
**Sealed by:** Overseer (Worker dispatch)
