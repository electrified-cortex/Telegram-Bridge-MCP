---
created: 2026-06-28
status: draft
priority: 20
source: adversarial review ab8cb879ac2793eff, 2026-06-28
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
severity: low
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
---

# TMCP — Wire ONBOARDING_HELP_TOPICS into governor startup delivery

**ID**: 10-3072
**Date**: 2026-06-28
**Priority**: Low
**Origin**: Adversarial review ab8cb879ac2793eff (post-push finding #5)

## Problem

`ONBOARDING_HELP_TOPICS` was added to `src/service-messages.ts` as part of 10-3063 (sub-session protocol docs). The constant exists and has correct shape (`eventType: "behavior_hint_help_topics"`, topic list) but is never imported or delivered anywhere. It is dead code until wired into a delivery path.

## Expected Behavior

When the governor session starts, `ONBOARDING_HELP_TOPICS` should be delivered to the agent — most likely via the same startup sequence that delivers `SPAWN_CHILD_SUBAGENT_HINT` and other `behavior_hint` events in `start.ts` (or equivalent startup entrypoint).

## Acceptance Criteria

- [ ] **AC1**: `ONBOARDING_HELP_TOPICS` is imported and delivered during governor session startup (or equivalent trigger), following the same pattern as other `behavior_hint` events.
- [ ] **AC2**: Delivery is scoped to governor sessions (not child sessions) — consistent with the existing onboarding message pattern.
- [ ] **AC3**: A test confirms the event is sent on governor startup. Existing tests remain green.

## Notes

- `ONBOARDING_HELP_TOPICS` is in `src/service-messages.ts`
- Delivery entrypoint is likely `src/start.ts` or wherever `SPAWN_CHILD_SUBAGENT_HINT` is sent on session open
- Do NOT change the constant definition — only add the delivery call
- Pre-existing lint baseline (visual-attachment-pipeline.ts, send.visual-pipeline.test.ts) must not be touched

## Overseer review

- reviewer: Overseer
- date: 2026-06-28
- verdict: PASS
- review type: inline gate (single delivery call, low blast radius)
- checked: ACs binary (constant delivered on governor startup, scoped correctly, test confirms), delegation correct, no open questions
