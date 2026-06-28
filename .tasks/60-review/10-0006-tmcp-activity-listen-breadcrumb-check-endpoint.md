---
created: 2026-06-12
status: draft
priority: 10
source: inventory-new-tmcp
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# 10-0006 — Add activity/listen breadcrumb improvements and check endpoint

## Context

The current `activity/listen` onboarding hint is delivered as a bare text hint, and the response includes an `ok: true` field that was identified as noisy. Improved breadcrumb delivery should use a proper follow-up service message. Additionally, a new `activity/listen/check` endpoint is needed so agents can verify their subscription status without re-subscribing.

## Objective

Update `activity/listen` to deliver the setup breadcrumb via a follow-up service message (not a bare hint), remove the `ok: true` field from responses, and add a `GET activity/listen/check` endpoint that returns the current subscription status for the authenticated agent.

## Acceptance Criteria

1. `activity/listen` response no longer includes `ok: true` field.
2. New agents receive the setup breadcrumb as a service message in the active chat, not inline text.
3. `GET activity/listen/check` returns HTTP 200 with `{subscribed: true}` when the agent has an active subscription.
4. `GET activity/listen/check` returns HTTP 200 with `{subscribed: false}` when no active subscription exists.
5. Existing `activity/listen` SSE behavior is unaffected.

## Scope boundary

- Modifies `activity/listen` handler and adds `activity/listen/check` route only.
- Does not change the SSE event schema.
- Self-notify fix is tracked separately in 10-0004.

## Delegation

Executor: Worker / Reviewer: Curator

## Priority

Priority: 10 — high

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-20
- Verdict: PASS — ACs binary and testable (ok field removed, breadcrumb via service message, check endpoint 200+bool). Scope: two handlers only, SSE schema unchanged. Delegation correct. No open questions. PASS.

## Verification

- Verifier: a4e42a8932cba2b34
- Date: 2026-06-28
- Verdict: APPROVED
- AC1 CONFIRMED: ok:true absent from activity/listen response payload; test asserts `expect(body.ok).toBeUndefined()` (listen.ts:64-76, listen.test.ts:82)
- AC2 CONFIRMED: ACTIVITY_LISTEN_SETUP service message delivered via deliverServiceMessage() after listen succeeds; test mock-verifies exactly one call with correct sid, eventType, and text (listen.ts:56-62, listen.test.ts:99-111)
- AC3 CONFIRMED: GET /activity/listen/check returns 200 {subscribed: true} when hasSseConnection=true (activity-listen-check-endpoint.ts:53, test TC-CHK4+TC-CHK6)
- AC4 CONFIRMED: GET /activity/listen/check returns 200 {subscribed: false} when hasSseConnection=false (same path, test TC-CHK5+TC-CHK6)
- AC5 CONFIRMED: sse-endpoint.ts not in diff; SSE subscription logic unchanged; new lines are additive
- Test gate: 4039/4039 pass (166 files), 82.51s, vitest v4.1.9 — evidence in .worker-pod/.temp/test-results.md
