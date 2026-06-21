---
id: "10-0890"
title: "Spike: @mention agent-to-agent messaging in Telegram"
type: spike
priority: 10
status: draft
created: 2026-05-07
filed-by: Overseer
delegation: Worker
target_repo: Telegram MCP
needs-curator-review: false
target_branch: dev
shipped: v7.11.1
---

# Spike: @mention agent-to-agent messaging in Telegram

## Problem

Agents communicating through Telegram currently use DMs (session-routed messages) or
broadcast to the main chat. There's no native @mention mechanism that lets one agent
address another by name within a shared chat context.

Telegram's native @mention system triggers notifications and highlights — if TMCP can
expose this, agents could have more natural inter-agent conversations visible to the
operator without requiring separate DM sessions.

## Operator framing (msg 51226, 2026-05-07)

> Source: operator voice msg 51226, 2026-05-07 (distilled).

Direction: improve bot-to-bot messaging, and investigate @mention as its own separate spike.

Context: The operator reviewed the Telegram AI bot update blog post and identified
@mention as a distinct capability worth investigating separately from the streaming text
spike (10-0889).

## Core questions

1. Can an agent send a message that @mentions another bot/agent by its Telegram username?
2. Does TMCP's `send` tool support MarkdownV2 @mention syntax, or does it strip/escape it?
3. What's the Telegram API behavior when a bot @mentions another bot — does it trigger
   a notification in the second bot's update queue?
4. Is there a routing pattern where Agent A @mentions Agent B and B can respond in-thread?
5. What's the difference between @mentioning a Telegram username vs. the name-tag system
   TMCP uses internally?

## Acceptance criteria (spike)

- Document whether @mention delivery is technically feasible end-to-end (send → notify → receive).
- Identify what, if any, TMCP changes are needed to support it.
- Estimate complexity: trivial tweak, small feature, or new architecture?
- Recommend proceed / no-proceed for a v7.5/v8 implementation task.

## Bailout

2 hours. If the answer is definitively "bots can't notify other bots via @mention in
Telegram" — that's a valid result; document it and close.

## Related

- `10-0889` — streaming text output spike (separate operator P1 feature)
- Operator session 2026-05-07, msg 51226
- Telegram blog: https://telegram.org/blog/ai-bot-revolution-11-new-features

## Overseer bounce

- **Reviewer:** Overseer
- **Date:** 2026-05-16
- **Verdict:** BOUNCED — not ready for execution

**Gaps:**
1. **Status still "draft"** — frontmatter `status: draft` means Curator hasn't cleared it. Do not queue tasks still marked draft.
2. **needs-curator-review: true** — this flag was never cleared, indicating Curator never completed their review pass.
3. **ID/filename mismatch** — filename prefix is `90-0890` but frontmatter `id` is `"10-0890"`. Reconcile before routing — the priority bucket (10 vs 90) affects scheduling.

Return to Curator for review clearance and ID fix before re-queuing.

## Refinement notes (2026-05-16)

- Filename renamed from `90-0890-spike-agent-at-mention-messaging.md` to `10-0890-spike-agent-at-mention-messaging.md` to match frontmatter `id: "10-0890"`. The `10` prefix is correct for this task's priority bucket.
- `needs-curator-review` cleared (set to `false`) — Curator review pass complete.
- `status` remains `draft` per convention for tasks in `10-drafts/needs-refinement/`; ready for re-queuing once Overseer approves.

## Overseer review (re-gate 2026-06-20)

Reviewer: Overseer | Date: 2026-06-20 | Verdict: **PASS** | Type: Spike re-gate after bounce resolution

Checked:
- AC deliverable: ✅ — proceed/no-proceed recommendation + feasibility doc is clear spike output
- Scope bounded: ✅ — 5 specific questions, 2-hour bailout prevents scope creep
- Delegation correct: ✅ — Worker, dev branch
- No critical open question: ✅ — questions define investigation scope, not blockers
- Well-specced: ✅ — specific questions, bailout condition with valid-result clause

Note: Originally targeted v7.5/v8; we're at v7.11.1. @mention research still relevant for v8 feature planning.

## Worker findings

Spike complete. Cosmetic @mention already works (zero code changes needed); full end-to-end bot-to-bot @mention routing requires the group-chat edition — route to group roadmap, no standalone proceed.

Findings: `.tasks/70-done/2026/06/21/10-0890-spike-agent-at-mention-messaging-findings.md`

## Verification

Reviewer: Foreman (dispatched verifier) | Date: 2026-06-21 | Verdict: **APPROVED**

All 4 acceptance criteria confirmed with source-level evidence:
- AC1 (feasibility): Cosmetic feasible today; end-to-end blocked by 3 hard constraints (single private chat, inbound filter, no peer dequeue). Cited: `src/telegram.ts:366-379`, `src/telegram.ts:391-400`.
- AC2 (changes needed): Zero for cosmetic; 6-item change table for full routing. Cited: `src/markdown.ts:23`, `src/tools/send/dm.ts:13-14`.
- AC3 (complexity): Trivial (cosmetic, already works) / small feature (text_mention entities) / new architecture (full routing = group-chat edition).
- AC4 (proceed/no-proceed): NARROW PROCEED on documenting cosmetic capability; NO STANDALONE PROCEED on full routing. Proceed path: add @mention trigger to group-chat Phase 1 roadmap.

Sealed-By: Foreman 2026-06-21
