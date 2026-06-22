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
dispatch_ready: true
needs_operator: false
---

# 10-0006 — Add activity/listen breadcrumb improvements and check endpoint

## Context

The current `activity/listen` onboarding hint is delivered as a bare text hint, and the response includes an `ok: true` field that was identified as noisy. Improved breadcrumb delivery should use a proper follow-up service message. Additionally, a new `activity/listen/check` endpoint is needed so agents can verify their subscription status without re-subscribing.

## Objective

Update `activity/listen` to deliver the setup breadcrumb via a follow-up service message (not a bare hint), remove the `ok: true` field from responses, and add a `GET activity/listen/check` endpoint that returns the current subscription status for the authenticated agent.

## Acceptance Criteria

1. [x] `activity/listen` response no longer includes `ok: true` field.
2. [x] New agents receive the setup breadcrumb as a service message in the active chat, not inline text.
3. [x] `GET activity/listen/check` returns HTTP 200 with `{subscribed: true}` when the agent has an active subscription.
4. [x] `GET activity/listen/check` returns HTTP 200 with `{subscribed: false}` when no active subscription exists.
5. [x] Existing `activity/listen` SSE behavior is unaffected.

## Verification

APPROVED by verifier a612df34e5dd3a079 — all 5 ACs confirmed, 3670/3670 pass, clean worktree (3 commits on 45030df5).

## Scope boundary

- Modifies `activity/listen` handler and adds `activity/listen/check` route only.
- Does not change the SSE event schema.
- Self-notify fix is tracked separately in 10-0004.

## Delegation

Executor: Worker / Reviewer: Curator

## Priority

Priority: 10 — high
