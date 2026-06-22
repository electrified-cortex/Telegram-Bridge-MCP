---
title: Sub-sessions should present as threads of the parent, not as peer sessions
stage: 10-drafts
author: Coordinating agent (live-test 2026-05-22)
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

Empirically verified by live test on 2026-05-22: the host spawned `TestThread`, the operator saw an approval dialog, then saw a new participant labeled `TestThread` alongside the parent — visually indistinguishable from any other peer session. The operator perceived two separate participants — exactly the wrong mental model.

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

Live test 2026-05-22 (parent session, sid=1, token=1601748):
- Called `action(type: 'session/spawn-child', name: 'TestThread', child_capability: 'gather')`
- Approval dialog appeared (R1 fail)
- Operator approved by clicking a color button
- Sub-session created as sid=2, token=2994402
- Announcement message 59475 fired in chat: "Session 2 — 🟢 Online" (R2 fail)
- Pin applied to message 59475 (R2 fail)
- Outbound from sid=2 displayed as a separate participant in chat (R3 fail)
- Sub-session's first dequeue contained 9 onboarding service messages, all from the host onboarding firehose (R4 + R5 fail)
- Operator described experience (distilled): perceived two separate participants, which was unexpected and wrong.

Conversation context: telegram messages 59474 through 59488.

## Agent review

Reviewer: Agent
Date: 2026-05-23
Verdict: NEEDS REFINEMENT
Review type: swarm (5 personalities — Devil's Advocate, Architect, Designer, Engineer, Security Auditor — + arbitrator)
Confidence: High

**v0.2 re-vet note (2026-05-23):** v0.2 claimed all 7 gaps addressed with defaults. Re-vet finds: Gap 3 genuinely closed by code; Gap 7 substantially closed pending one wording fix. Gaps 1, 2, 4, 5, 6 remain structurally identical to v0.1 — no new decision text exists for any of them. 6 new critical findings added (see below). Returning for v0.3.

### What was checked
- Requirements completeness and internal consistency
- Acceptance criteria testability
- Public API surface and backward compatibility
- Structural soundness and evolvability
- Practical correctness under edge cases
- Authorization model and trust boundary

### Not checked
- Technical correctness of implementation (that's the worker's job post-spec-pass)

### Gap status after v0.2

| Gap | Status |
|-----|--------|
| 1 — Onboarding positive list | OPEN — "Exact wording TBD" still in R4; AC4 vacuous-truth bug unchanged |
| 2 — Index allocation strategy | OPEN — "frees its index for re-use" with no gap-fill/next-available decision |
| 3 — Parent token verification | **CLOSED** — `requireAuth` + `getCallerSid()` cross-check at `spawn-child.ts:24–35`, covered by integration tests |
| 4 — Cascading revocation | OPEN — C2 "semantics unchanged" = no cascade; children survive parent ban |
| 5 — SUB_SESSION_LIMIT error shape | OPEN — "placeholder" still in open questions; no namespace, no payload, no enforcement in code |
| 6 — Name-tag display rule | OPEN — R3 "unchanged" + C4 "count toward active" = name tag fires for parent + one child; identity collapse |
| 7 — setSessionAnnouncementMessage | SUBSTANTIALLY CLOSED — B2 prohibits announcement; "probably" wording should be hardened to "MUST NOT" |

### Must resolve before passing (updated — all prior open items + new additions)

**From v0.1 bounce, still open:**

1. **Onboarding positive list.** Define exact key names for the four positive categories (token, role context, loop instruction, exit protocol). "Exact wording TBD" is not acceptable even if body text is deferred — the key identifiers must be pinned now so sub-agent authors can write deterministic startup code. Also: AC4 lists 7 suppressed keys but R4 lists 9 — add `onboarding_token_save` and `onboarding_no_pending_yet` to AC4.

2. **Index allocation strategy.** Choose: gap-fill (lowest-free) or next-available (monotone). State explicitly in AC3a. Also specify whether the 9-child limit counts "currently alive" or "ever allocated this session" — the counter semantics determine when SUB_SESSION_LIMIT fires after revoke+respawn cycles.

3. **~~Parent token verification.~~** Closed.

4. **Cascading revocation.** When a parent session is closed (any path: `session/close`, health-check, crash), all registered child sessions must be revoked before or atomically with the parent teardown. Add an explicit requirement. Prerequisite: `getChildren(parentSid)` inverse query must be added to whichever store is designated authoritative (see new item 8 below).

5. **SUB_SESSION_LIMIT error shape.** Define: error code string, namespace (consistent with existing TMCP error patterns), payload fields (`limit: 9`, `current: N`, `parent_sid`). The per-parent scope must be expressed in the payload so callers in multi-parent dispatch scenarios know which parent is saturated.

6. **Name-tag display rule.** The `activeSessionCount() < 2` threshold in `outbound-proxy.ts:38` must be replaced with a `primarySessionCount() < 2` threshold (counting only sessions without `parent_sid`). C4 makes sub-sessions full session citizens for governance, but the display rule must operate on primary sessions only. Spec must require this distinction and name the new predicate.

7. **`setSessionAnnouncementMessage` lifecycle.** Change "probably not needed since there's no announcement" to: "`setSessionAnnouncementMessage` MUST NOT be called for sub-sessions. `revoke-child` cleanup must handle the case where no announcement record exists (no-op, not error)."

**New — found in v0.2 re-vet:**

8. **Authoritative parent/child store.** `child-registry.ts` (flat `Map<childSid, parentSid>`) and `Session.parent_sid` in `session-manager.ts` coexist with a fallback chain in `revoke-child.ts:29`. Designate one canonical store. Add `getChildren(parentSid): number[]` inverse query to it. Required by items 4 and 5, and by the per-parent index counter.

9. **Recursive spawn gate.** With the approval dialog removed, any `full`-capability child session can call `session/spawn-child` and create grandchildren without operator interaction. Add an explicit requirement: `session/spawn-child` is only callable by sessions with no `parent_sid` (root sessions). A session whose own `parent_sid` is set must receive `UNAUTHORIZED` regardless of `child_capability`.

10. **SESSION_JOINED suppression.** B2 says `SPAWN_CHILD_SUBAGENT_HINT` is "the only signal the operator sees." But `handleSessionStart` unconditionally broadcasts `SESSION_JOINED` to all existing sessions at `start.ts:408–420`. Add a requirement: sub-session creation must NOT trigger `SESSION_JOINED` delivery to peer sessions. (This also suppresses the spurious governor re-election at `start.ts:373–376`.)

11. **`profile/topic` restricted to root sessions.** A compromised sub-session can call `action(type: 'profile/topic', topic: "")` to clear its chip, making its messages visually identical to the parent's (no topic chip). Add `profile/topic` to `GATHER_BLOCKED` OR require that topic is set-once at spawn time and immutable thereafter for sessions with `parent_sid`.

12. **Index counter persistence.** The per-parent child count must survive crash recovery (parent session reload from persistence). If the counter is not durable, a crash+reload cycle resets it to zero and allows more than 9 sub-sessions across the session lifecycle.

13. **spawn-child return payload: add `display_index`.** Include the integer index (1–9) in the return payload alongside `token/sid/parent_sid`. Callers must not need to parse the chat topic chip to know which slot was assigned. (Repeated from v0.1 non-blocking — now escalated to blocking because the index allocation strategy and limit enforcement both require the caller to have this value.)

### Should address (non-blocking on pass gate)

- AC1 wording "returns synchronously" → "returns without awaiting operator approval" (v0.1 non-blocking, still unaddressed).
- Voice/animation profile inheritance: open question must be resolved (likely inherit; this underlies B3's "same color" MUST guarantee).
- `color` parameter in spawn-child schema: describes "operator makes final choice via approval dialog" — approval is being removed. Decide: inherit parent color always, or allow caller-specified color without operator confirmation, or deprecate for spawn-child.
- Topic chip glyph formula: document `String.fromCodePoint(0x245F + display_index)` so callers can construct search strings programmatically.

### Implementation notes (informational — these are the worker's fixes, not spec gaps)

From v0.1 review, still valid: (1) `handleSessionStart` called unconditionally from `spawn-child.ts:39`; (2) announcement + pin at `start.ts:382–400`; (3) full onboarding at `start.ts:435–440`; (4) spawn-child hint uses parent token not child token (`spawn-child.ts:65`); (5) `SESSION_JOINED` + governor-update at `start.ts:408–420, 373–376` have no sub-session guard; (6) `child-registry.ts` has no `getChildren()` inverse; (7) `profile/topic` not in `GATHER_BLOCKED`; (8) `applyTopicToText` in `topic-state.ts` has no sub-session index awareness.
