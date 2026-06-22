---
id: "15-754"
title: "Checklist: skipped-vs-incomplete semantics"
priority: 15
status: pending
created: 2026-04-20
repo: Telegram MCP (or agent-lifecycle skills)
---

# 15-754 — Checklist skipped semantics

## Context

Operator 2026-04-20 (msgs 39112/39113): when a worker's lifecycle checklist produces "5/7 completed, 2 skipped," this reads as incomplete/failure. It isn't — a skipped step means "not applicable to this task type" (e.g. build-verification on a skill-authoring task where there's nothing to build).

Two root-cause framings:
- **Upstream (preferred)**: the worker shouldn't have included inapplicable steps in its checklist in the first place. If there's no build, there's no build-verification item.
- **Downstream (signal)**: even when skipping is justified, the rendered summary should make "skipped intentionally" distinguishable from "incomplete."

## Acceptance Criteria

Investigate both framings and pick one (or combine):

1. **Worker checklist construction (upstream)**: update worker lifecycle skill(s) so the checklist is built from task-type-aware templates — a build-verification step only appears if the task produces build artifacts. See task #12 (build-verification task-awareness) — this overlaps heavily; consider merging.

2. **Checklist summary rendering (downstream)**: the checklist/update API (Telegram MCP) should compose a completion line that:
   - Reads as "complete" when `skipped` is non-zero but no steps are `failed` or `pending`.
   - Or introduces a new state like "complete with notes" / "complete (N skipped, reason: …)."
   - Today's "5/7 completed, 2 skipped" invites operator misread. Fix is either wording or a completion flag.

3. If (1) is chosen: any step that reaches the worker and is not applicable must be *removed from the checklist*, not marked `skipped`. `skipped` remains for runtime decisions (e.g. tests skipped due to prior failure), not for "this step doesn't apply to this task type."

4. If (2) is chosen: specify the exact wording + TMCP API shape. Send to a worker only after Curator + operator agree on the signal design.

## Constraints

- Don't bolt on both solutions at once — pick the cleaner mental model.
- Changes to TMCP checklist rendering require a release cycle; worker-side template changes are cheaper.
- Coordinate with task #12 — likely same fix, different lens.

## Priority

15 — UX/semantic, not correctness. Current summary isn't wrong, just misreads. Bundle with #12.

## Delegation

Curator to design; worker executes once design agreed.

## Related

- Task #12 (worker lifecycle: build-verification task-type-awareness)
- `mcp__telegram-bridge-mcp__send` checklist type — rendering source of truth


## Verification

APPROVED: 15-754 — 2026-06-21
Verifier: ad044c9653a28bd11
AC2 (downstream rendering): CONFIRMED — update.ts lines 71-84 (ternary ternary: failed→🔴, else→✅)
AC4 (exact wording): CONFIRMED — update.ts 77-83, update.test.ts 267-289
AC3 (N/A — upstream path not chosen): N/A
Test gate: CONFIRMED — .temp/test-results.md + test-plan.md present; 33 checklist tests pass
Sealed-By: foreman
