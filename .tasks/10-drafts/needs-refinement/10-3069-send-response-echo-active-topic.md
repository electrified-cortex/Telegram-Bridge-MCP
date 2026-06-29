---
title: "TMCP: send response should echo active_topic when topic is active but not explicitly passed"
id: 10-3069
priority: P10
status: draft
category: Feature/UX
filed: 2026-06-28
source: TG 80701
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: worker/tmcp-p4-active-topic-echo
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

## Refinement history

- Overseer bounce 2026-06-28: FAIL — AC4 type list written from assumption (not code-verified); AC1 "explicit" definition ambiguous; question type not split by sub-mode.
- Fixed 2026-06-28: AC4 rewritten from code audit of `send.ts`; AC1 clarified with exact `undefined` check; question sub-modes split; AC5 added for failed-send behavior.

# Send Response: Echo Active Topic When Implicitly Active

## Problem

When an agent calls `send()` without specifying `topic`, but a topic is active via `profile/topic`, the response gives no indication. Agents can unknowingly send into the wrong topic for an entire session without realizing it.

## Operator specification (TG 80701)

If a successful message is sent without an explicit `topic` parameter, but a topic is currently active, the response must include what the topic was — so the agent realizes it has one set. This should NOT fire if the agent explicitly passed `topic` (even `topic: ""` to suppress it), because then the agent already knows.

## Code ground truth (send.ts audit — 2026-06-28)

Types that pass `topic` to their downstream handler (topic-branded sends):
- `text` — `applyTopicToText(…, args.topic)` directly
- `notification` — `handleNotify({ …, topic: args.topic })`
- `choice` — `handleSendChoice({ …, topic: args.topic })`
- `question` (ask sub-mode only) — `handleAsk({ …, topic: args.topic })`

Types that do NOT receive topic (not topic-branded):
- `file`, `append`, `animation`, `checklist`, `progress` — no `topic` param in handler call
- `question` (choose/confirm sub-modes) — no `topic` in `handleChoose` or `handleConfirm`
- `dm` — by design, no topic

## Acceptance Criteria

- **AC1**: When `send()` is called with `args.topic === undefined` (not passed at all — NOT falsy, NOT empty string), AND a topic is currently active via `profile/topic`, the response for successful sends MUST include `{ active_topic: "<topic-string>", … }`.
- **AC2**: When `send()` is called with `args.topic` set to any value (including `""` to suppress), the response does NOT include `active_topic`.
- **AC3**: When no topic is active (topic is null/cleared), the response does NOT include `active_topic`.
- **AC4**: `active_topic` echoing applies ONLY to topic-branded types: `text`, `notification`, `choice`, and `question` (ask sub-mode only). Does NOT apply to: `file`, `append`, `animation`, `checklist`, `progress`, `question/choose`, `question/confirm`, `dm`.
- **AC5**: `active_topic` is NOT included in error responses or failed send responses — only on success.
- **AC6**: Additive field only — existing callers are unaffected.

## Implementation notes

- "Implicit" = `args.topic === undefined`. Do NOT use `!args.topic` — that incorrectly catches `topic: ""` (which is a deliberate suppress-for-this-send, and the agent knows it).
- Check the session's active topic via `getTopic()` at send time; inject into response envelope when AC1-AC4 conditions are met.
- The `active_topic` field is advisory — agents use it to self-correct (e.g., call `action(type: "profile/topic", topic: "")` to clear).

## Scope

Single change: inject `active_topic` into send response envelope. Low blast radius.
