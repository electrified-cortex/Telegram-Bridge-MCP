---
title: Sub-sessions should present as threads of the parent, not as peer sessions
stage: 10-drafts
author: Curator (live-test 2026-05-22)
date: 2026-05-22
target_repo: electrified-cortex/Telegram-Bridge-MCP
priority: P2
related:
  - tasks/10-drafts/10-2100-threaded-conversations-prd.md (downstream skills layer that builds on this)
  - tasks/70-done/2026/05/17/sub-session-dispatch-skill-migration-2026-05-17.md (prior sub-session work)
---

# Sub-session presentation cleanup

## Problem

`action(type: 'session/spawn-child')` today goes through the same code path as `session/start` (calling `handleSessionStart` internally). The result is that a sub-session is presented to the operator as a brand-new peer session: it gets the operator approval dialog (color picker), a new "Session N — Online" announcement message, an inline keyboard, an announcement pin, and the full onboarding firehose of service messages designed for a top-level session.

Empirically verified by live test on 2026-05-22: the host spawned `TestThread`, the operator saw an approval dialog, then saw a new participant labeled `TestThread` alongside `Curator` — visually indistinguishable from any other peer session. Operator described this as "I have two participants now" — exactly the wrong mental model.

The intended model: a sub-session is the parent's own work-stream isolated by topic. The operator should see ONE participant (the parent) handling MANY topics, where each sub-session is a topic thread.

## Goal

Sub-sessions remain architecturally distinct (own SID, own queue, own dequeue loop, own token, own routing isolation) but PRESENT as the parent with a topic chip — not as a separate participant.

## Requirements

R1. **No operator approval dialog on spawn-child.** Trust is inherited from the parent who is already authorized. The sub-session spawn returns immediately with token/sid/parent_sid; no dialog appears in chat.

R2. **No new "Session N — Online" announcement message** in chat for sub-sessions. Sub-sessions do not claim pin slots.

R3. **Identity inheritance + numbered topic.** A sub-session's outbound name tag is identical to the parent's (same color, same name) — the existing rule "name tag only shown when multiple primary sessions are active" applies unchanged.

  The differentiator is the **topic**. TMCP preserves the existing topic format — bold square brackets, e.g. `**[TestThread]**` — and inserts a **Unicode circle digit** (①②③④⑤⑥⑦⑧⑨) for the sub-session's per-parent index inside the brackets, **after the topic name**, separated by a single space. The Unicode circle is intentional: it makes the marker visually distinct as a sub-thread indicator (no risk of being read as a normal letter or number in the topic name).

  Canonical placement: `**[TestThread ①]**`

  Per-parent limit: 9 sub-sessions (indices ①-⑨, internally 1-9). A 10th spawn returns an error.

R4. **Narrower onboarding.** Sub-sessions on first dequeue receive a tailored set of service messages — NOT the host firehose (`onboarding_token_save`, `onboarding_loop_pattern`, `onboarding_no_pending_yet`, `onboarding_hybrid_messaging`, `onboarding_activity_file_hint`, `onboarding_protocol`, `onboarding_modality_priority`, `onboarding_presence_signals`, `behavior_nudge_first_message`).

The sub-session's onboarding should cover at minimum:
  - Token (it's a real token, save it for the duration of the dispatch)
  - Role context: "you are a sub-agent handling topic X under parent Y"
  - Loop instruction: dequeue continuously
  - Exit protocol: resolve, summarize, or surface action — then revoke-child

Exact wording TBD; design in a follow-up pass.

R5. **No `behavior_nudge_*` and no activity-file hint** for sub-sessions. Sub-agents run in tight dequeue loops; they do not need their own file monitor and they don't need the host-flavored presence/reactions guidance.

## Behavior

B1. `session/spawn-child` skips the operator approval flow (`requestApproval`). The sub-session is created and registered immediately. No callback handler waits for an approval ticket.

B2. After the sub-session is created, no `getApi().sendMessage(...)` announcement and no `pinChatMessage` call. The sub-session simply exists in the bridge — the host's outbound message to the parent's queue (the new `SPAWN_CHILD_SUBAGENT_HINT`) is the only signal the operator sees.

B3. Outbound messages sent from the sub-session token MUST carry the derived name tag (parent identity + topic) so the operator sees a single participant with multiple topic chips.

B4. The sub-session's first dequeue delivers the narrower onboarding set. The full host onboarding is suppressed.

## Constraints

C1. The sub-session still has its own SID, its own token, its own message queue, and its own dequeue loop. No routing-layer changes.

C2. `session/revoke-child` semantics unchanged.

C3. `child/forward` semantics unchanged.

C4. Sub-session count toward the active-session count for governance and routing — they ARE sessions. The change is presentation-only.

## Acceptance criteria

AC1. `action(type: 'session/spawn-child', name, child_capability)` returns synchronously without showing an approval dialog to the operator.

AC2. The chat does NOT receive a "Session N — Online" message and no pin is applied to the sub-session's session record. Verified by chat history inspection after spawn.

AC3. A message sent with the sub-session token presents as the parent (same color + name tag, following existing single-vs-multi-session display rules). The topic chip is rendered as `**[<topic_name> <circle_digit>]**` — bold square brackets enclosing the topic name, then a single space, then the Unicode circle digit (①-⑨). The bracket-bold convention is non-negotiable; the circle digit is the sub-thread marker.

AC3a. Spawning a 10th sub-session under the same parent returns `SUB_SESSION_LIMIT` error; the 9 existing children remain unaffected. Revoking a child frees its index for future re-use.

AC4. The sub-session's first dequeue returns the narrower onboarding (TBD exact list) — does NOT include `onboarding_loop_pattern`, `onboarding_activity_file_hint`, `onboarding_protocol`, `onboarding_modality_priority`, `onboarding_presence_signals`, `onboarding_hybrid_messaging`, or `behavior_nudge_first_message`.

AC5. Existing peer-session behavior is unchanged. A `session/start` with no parent SID still goes through approval, gets the announcement, the pin, and the full onboarding.

AC6. `session/revoke-child` continues to work and emits the existing `session_closed` service message to the parent.

## Out of scope

- The threaded-conversations PRD (10-2100) Haiku-router skill suite. This task is purely the TMCP-layer presentation cleanup that the PRD builds on.
- The sub-agent's structured exit protocol (resolved | action | summary). Separate follow-up.
- `message/history` per-SID filter. Separate follow-up.
- Any harness-side changes (CC's Agent tool, SendMessage continuation, etc.). Out of scope.

## Open questions

- Should the sub-session inherit the parent's voice/animation profile, or have its own? Likely inherit, but confirm.
- Does `setSessionAnnouncementMessage` still get called for sub-sessions (so revoke can find something to clean up)? Probably not needed since there's no announcement.
- Does the host's `SPAWN_CHILD_SUBAGENT_HINT` still fire? YES — that's the host-side signal that the spawn worked. Different from the chat-side announcement, which is what we're killing.
- What exact error code for the 10-sub-session limit? `SUB_SESSION_LIMIT` is a placeholder.

## Evidence

Live test 2026-05-22 (Curator session, sid=1, token=1601748):
- Called `action(type: 'session/spawn-child', name: 'TestThread', child_capability: 'gather')`
- Approval dialog appeared (R1 fail)
- Operator approved by clicking a color button
- Sub-session created as sid=2, token=2994402
- Announcement message 59475 fired in chat: "Session 2 — 🟢 Online" (R2 fail)
- Pin applied to message 59475 (R2 fail)
- Outbound from sid=2 displayed as a separate participant in chat (R3 fail)
- Sub-session's first dequeue contained 9 onboarding service messages, all from the host onboarding firehose (R4 + R5 fail)
- Operator described experience: "I have two participants now. That is weird."

Conversation context: telegram messages 59474 through 59488.
