---
title: "TMCP: send response should echo active topic when topic is set but not explicitly passed"
id: 10-3069
priority: P10
category: Feature/UX
created: 2026-06-28
source: Operator directive (voice 80701) + Overseer
---

# Send Response: Echo Active Topic When Implicitly Set

## Problem

When an agent calls `send()` without specifying a `topic`, but a topic is already set via `profile/topic`, the response currently just returns `{ message_id, ... }` with no indication that the message was sent under an active topic.

This means agents can unknowingly send messages into the wrong topic thread for an entire session without realizing it — the "simple-im" topic lingered undetected because nothing in the send response flagged it.

## Operator specification (voice 80701)

> "If you send a successful message and you didn't specify a topic, but a topic is set, the response needs to include what the topic was. That way you realize: oh, hey, I have a topic set. You would NOT do it if the topic was set explicitly — because the agent would know that."

## Acceptance Criteria

- AC1: When `send()` is called **without** an explicit `topic` parameter, AND a topic is currently active (set via `profile/topic`), the response MUST include `{ active_topic: "<topic-string>", ... }` alongside the normal `message_id` fields.
- AC2: When `send()` is called **with** an explicit `topic` parameter, the response does NOT include `active_topic` (the agent already knows).
- AC3: When no topic is set (topic is null/cleared), the response does NOT include `active_topic`.
- AC4: Applies to: `send(type: "text")`, `send(type: "notification")`, `send(type: "question")`, `send(type: "animation")`, `send(type: "checklist")` — the same types that `profile/topic` brands.
- AC5: Does not apply to `send(type: "file")` (consistent with `profile/topic` non-application).
- AC6: Existing clients are unaffected (additive field only).

## Implementation notes

- The `active_topic` field is advisory — agents use it to self-correct (e.g., call `action(type: "profile/topic", topic: "")` to clear).
- Check the session's active topic at send time; inject into response envelope if set and not explicitly passed.

## Scope

Single send path — inject `active_topic` into response when conditions met. Low blast radius.

## Overseer bounce

- reviewer: Overseer
- date: 2026-06-28
- verdict: FAIL — needs refinement
- review type: adversarial sub-agent dispatch

### Blockers

**AC4 type list is code-incorrect.** The enumerated types ("text, notification, question, animation, checklist") were written from assumption, not from reading `send.ts`. Actual code behavior:
- `animation`: `handleShowAnimation` receives NO `topic` parameter — profile topic does NOT brand animation → should NOT be in AC4
- `checklist`: `handleSendNewChecklist` receives NO `topic` parameter — same → should NOT be in AC4
- `choice`: `handleSendChoice` DOES receive `topic: args.topic` → IS topic-branded → MISSING from AC4
- `question`: only the `ask` sub-mode passes `topic`; `choose` and `confirm` sub-modes do NOT → needs explicit split

**AC1 "explicit topic" is ambiguous.** Zod schema is `z.string().optional()`. `undefined` = absent (implicit); `""` = empty string (suppress for this send, still "explicit"). The existing `applyTopicToText` logic distinguishes these. Task must state: "implicit" = `args.topic === undefined`, not `!args.topic`. A worker checking the falsy condition would incorrectly suppress `active_topic` when `topic: ""` is passed to suppress branding.

### Required fixes before re-queue

1. Audit `send.ts` to enumerate exactly which types pass `topic` to their downstream handler (code-verified). Update AC4 to that exact list.
2. Split `question` type into sub-modes: only `ask` should receive `active_topic` in response; `choose` and `confirm` should not.
3. Add to AC1: "implicit means `args.topic === undefined`" (not just falsy).
4. Optional: clarify whether `active_topic` appears on failed send responses (operator said "successful message").
