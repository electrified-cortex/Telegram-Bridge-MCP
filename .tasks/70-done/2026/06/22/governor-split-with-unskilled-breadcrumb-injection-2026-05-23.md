---
title: "Governor split — unskilled tier gets breadcrumb-service-message guidance for sub-session handling"
stage: 10-drafts
author: "Curator (synthesized from operator voice msgs 60091 + 59314-59335)"
date: 2026-05-23
target_repo: electrified-cortex/Telegram-Bridge-MCP
priority: 10
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
related:
  - "tasks/10-drafts/10-2100-threaded-conversations-prd.md (downstream skill suite that uses this pattern)"
  - "tasks/10-drafts/sub-session-presentation-cleanup-2026-05-22.md (presentation layer prerequisite)"
  - "Curator task #15 (Governor split label; this spec is the substantive expansion)"
version: v0.2
dispatch_ready: true
needs_operator: false
blocked_on: ""
---

# Governor split: unskilled tier gets breadcrumb-service-message guidance

## Problem

The threaded-conversations PRD (10-2100) assumes either (a) a skilled host with a haiku-driven router skill OR (b) a degraded manual mode where the operator drives thread creation explicitly. Missing: the **middle tier** — an unskilled host that doesn't have a router skill but CAN handle sub-sessions if the bridge tells it how, via the same breadcrumb-style service messages that already work for the monitor onboarding chain (shipped 2026-05-22 via `ACTIVITY_FILE_MONITOR_INSTRUCTIONS` + post-registration enqueue).

The core issue is that ambiguous incoming messages need routing, but routing them in-host pollutes and can confuse the host context. The goal is to ensure the unskilled host agent knows what to do purely by receiving the right Telegram service messages.

## Goal

When a host receives a message it cannot confidently route to an existing thread, it explicitly requests breadcrumb guidance from the bridge. The bridge injects breadcrumb-style service messages teaching the host: when to spawn a sub-session, how to forward the inbound message to it, and what the host's own role is (orchestrator, not content-processor).

An unskilled host can drive the threaded-conversations pattern from breadcrumbs alone — no skill file required. A skilled host (with haiku-driven router skill) suppresses the breadcrumbs by signaling its tier at session start.

## Requirements

R1. **New service message: `ONBOARDING_SUBSESSION_HOST_ROLE`** — delivered in response to a host's `session/request-guidance` action (see R4). Explains: "You may receive inbound messages that aren't a reply to a known thread. Route these by spawning a sub-session (`session/spawn-child`) and forwarding via `child/forward`. The sub-agent handles content; you stay context-clean."

R2. **New service message: `ONBOARDING_SUBSESSION_SPAWN_BREADCRUMB`** — enqueued together with R1 in the same `session/request-guidance` response batch. Explains the spawn-and-forward sequence with the exact action signatures + parameter names. Following this breadcrumb, the unskilled host can spawn a sub-session and forward the inbound message without any other guidance. (R1 and R2 are always enqueued as a pair; the host receives both in the next DQ.)

R3. **New service message: `ONBOARDING_SUBSESSION_RESOLVE_BREADCRUMB`** — enqueued when the bridge receives a terminal signal from a sub-session (e.g., parent calls `session/revoke-child`, or sub-session session lifetime expires). Delivered to the parent host exactly once per host session lifetime. Explains: "Sub-agent has been revoked. Your slot is free. You are the orchestrator; await the next inbound or operator turn."

R4. **Ambiguous-message detection is HOST-side.** The host — which owns `data/thread-registry.json` per PRD 10-2100 — is the correct layer to determine when a message cannot be routed to a known thread. When the host makes that determination, it emits:

```
action(type: 'session/request-guidance', guidance_type: 'subsession-routing')
```

Bridge reacts to this explicit request by enqueuing R1 + R2 (if the session is unskilled and has not yet received them). Bridge does NOT attempt to infer ambiguity from message characteristics.

R5. **Tier detection** — bridge knows whether host is unskilled or skilled. If skilled: suppress R1/R2/R3 breadcrumbs. If unskilled (default): deliver them on request.

R6. **One-shot per session with compaction recovery.** Each breadcrumb message is delivered ONCE per host session lifetime. After first delivery, a durable `subsession_guidance_delivered` flag is persisted (same mechanism as `firstUseHintsSeen`, but written to the session's durable store rather than in-memory only). On bridge restart/compaction, the flag survives and AC5 holds. If the flag is absent after restart (e.g., pre-flag session), treat as not-yet-delivered (safe default: re-arm rather than suppress).

R7. **Skilled hosts opt out by signaling tier at session start.** A root session that has loaded a router skill signals:

```
action(type: 'profile/tier', tier: 'skilled-router')
```

Default tier on no signal = unskilled (safest — host gets guidance on request). The `profile/tier` action is gated to root sessions only (see Constraints C5).

## Behavior

B1. On `session/start` for any session: tier defaults to unskilled until the root session signals `profile/tier: skilled-router`.

B2. On `action(type: 'session/request-guidance', guidance_type: 'subsession-routing')` from an unskilled host that has not yet received guidance: bridge enqueues R1 and R2 together into the host's next DQ batch. Sets `subsession_guidance_delivered = true` in durable session store.

B3. On `action(type: 'session/request-guidance', guidance_type: 'subsession-routing')` from a host that has already received guidance (flag set): bridge returns an acknowledgement without re-enqueuing. (Idempotent.)

B4. On first sub-session terminal signal (parent calls `session/revoke-child`, or sub-session lifetime ends) for an unskilled host: bridge enqueues R3 to parent (once per session lifetime; subsequent terminal signals are no-ops for R3).

B5. Skilled hosts (via R7 opt-out): no breadcrumbs fired on `session/request-guidance`; request is acknowledged silently. Behavior unchanged from current.

## Constraints

C1. Two new actions are introduced by this task: `session/request-guidance` (host → bridge) and `profile/tier` (root session → bridge). Existing actions `session/spawn-child`, `child/forward`, `session/revoke-child` are unchanged.

C2. Existing `session/start` flow unchanged. Tier defaults to unskilled silently.

C3. Skilled-tier opt-out (`profile/tier`) is additive. Does NOT remove or alter existing actions.

C4. Subsession-presentation-cleanup task (the P2 in 10-drafts) is a prerequisite — the breadcrumbs assume sub-sessions present as parent-with-thread-chip, not peer participants.

C5. **`profile/tier` is gated to root sessions only.** A session is a root session when `parent_sid === null`. Any child session (any session where `parent_sid` is set) that calls `profile/tier` receives a `PERMISSION_DENIED` error with message: "profile/tier may only be set by a root session." This is enforced at the action-dispatch layer before any tier mutation occurs. Child sessions cannot suppress breadcrumbs on the parent's behalf.

C6. **`profile/tier` is not an independent capability system.** The `tier` field is a lightweight signal for breadcrumb suppression only. It is explicitly positioned as a subset view of the PRD 10-2100 capability model. Precedence rule: if PRD 10-2100's full capability model is active for a deployment, that model takes precedence and `profile/tier` is ignored (or treated as informational). `profile/tier` is the fallback for simpler deployments that have not implemented the full capability model. Worker must document this precedence in the relevant source file.

## Acceptance criteria

AC1. Three new service-message templates exist in `src/service-messages.ts`: `ONBOARDING_SUBSESSION_HOST_ROLE`, `ONBOARDING_SUBSESSION_SPAWN_BREADCRUMB`, `ONBOARDING_SUBSESSION_RESOLVE_BREADCRUMB`. Wording matches the breadcrumb style of `ACTIVITY_FILE_MONITOR_INSTRUCTIONS` (direct, concrete, no fluff).

AC2. `session/request-guidance` action exists and is documented in the action registry. A root unskilled host calling it triggers R1 + R2 enqueue. Verified by inspecting the host's queue contents after the call.

AC3. R1 and R2 are enqueued as a pair in the same batch (host receives both in one DQ call). Verified by inspecting the DQ response after `session/request-guidance`.

AC4. Bridge fires R3 on the first sub-session terminal signal to the parent (unskilled host only). Verified by spawning a sub-session, calling `session/revoke-child`, then inspecting parent's queue.

AC5. Each breadcrumb message delivered EXACTLY ONCE per host session lifetime, surviving bridge restart. Verified by: (a) triggering R1+R2, (b) restarting the bridge, (c) calling `session/request-guidance` again — host must NOT receive a second pair.

AC6. Skilled-tier opt-out: a root session that signals `profile/tier: skilled-router` at session start receives NO breadcrumbs on subsequent `session/request-guidance` calls. Verified by inspecting the host's queue after the same scenario as AC2.

AC7. Child session calling `profile/tier` receives `PERMISSION_DENIED`. Verified by spawning a child session and attempting `profile/tier: skilled-router` from it.

AC8. `bridge_authoritative: true` is present on all R1/R2/R3 service message deliveries. `child/forward` payloads set `bridge_authoritative: false` (or omit the field). Verified by inspecting the raw envelope of each delivery path.

AC9. Tier defaults to unskilled when no signal received. New hosts get breadcrumbs on first `session/request-guidance` call.

## Verification

APPROVED by verifier abc8694a899749606 — all 9 ACs confirmed, 3763/3763 tests pass (156 test files), clean worktree. Squash 80a679c7 on release/v7.11.1, rebased onto 136b9fba (10-0006).

## Out of scope

- The router skill itself (operator/skill author writes that; covered by PRD 10-2100 OQ1).
- Sub-session presentation as parent-with-thread-chip (sub-session-presentation-cleanup task is prereq — C4).
- Auto-classification of message content (that's the skilled tier).
- TTL / revival / closed-thread reopening (PRD 10-2100 OQ-A).
- Cross-host coordination (multiple primary sessions sharing sub-sessions).

## Open questions

OQ1. **[DECISION PENDING] Default tier for hosts existing before this lands.** Proposed: existing hosts are unskilled retroactively (they get breadcrumbs on their first `session/request-guidance`). Reasoning: safer; teach the existing fleet rather than assume skill presence. Confirm or override at dispatch.

## Evidence

- Voice msg 60091 (2026-05-23T20:11:13Z): operator outlined the unskilled/skilled split.
- Voice msgs 59314-59325 (2026-05-22T~03:00Z, ~8pm PT): operator designed the breadcrumb chain pattern for monitor onboarding. Pattern shipped.
- Curator's response 60092 (2026-05-23T20:11:48Z): noted that the governor-split was filed as task #15 — but the substantive breadcrumb-injection mechanism was NOT captured in task #15's title alone. This spec is the substantive capture.

## Delegation

Worker-claimable (Overseer dispatches). Worker pulls TMCP repo, implements per requirements + behavior + ACs.

## Overseer bounce

- **Reviewer:** Overseer
- **Date:** 2026-05-23
- **Verdict:** NEEDS REFINEMENT
- **Review type:** swarm (Devil's Advocate, Engineer, Security Auditor, Architect, Simplicity Lover + arbitrator)
- **Confidence:** High

### Obvious actions (2+ reviewers independently)

1. **R4 trigger is unconditional.** "First inbound with no resolvable reply-thread" is vacuously true for every fresh unskilled host (no threads exist yet). Fires on "good morning." One-shot slot (R6) consumed before any sub-session context exists. Must add a meaningful discriminator — e.g., require the host to have received a prior reply-threaded exchange before the breadcrumb fires, or let the host explicitly request the breadcrumb. *(DA, Engineer, Security Auditor)*

2. **R2/R3 timing under-defined.** "Next DQ after R1" conflates when R1 is enqueued with when it is consumed — fast-polling host receives both in one cognitive burst. `r1_pending_r2` flag has no TTL and leaks on session close. R3 uses "thread/resolved" which does not exist in the codebase; `session/revoke-child` is parent-initiated, not sub-session-initiated. *(DA, Engineer)*

3. **One-shot durability missing.** `firstUseHintsSeen`-style in-memory flag resets on bridge restart/compaction. AC5 ("exactly once per session") is violated on every restart. Prior art (monitor chain) has a compaction-recovery message; this spec has no equivalent. *(DA, Engineer)*

4. **C1 contradicts AC6.** C1 says "no new actions or tools required." AC6 requires `action(type: 'profile/tier', tier: 'skilled-router')` to exist. Direct contradiction; one must change. *(DA, Engineer)*

### Critical actions (ship blockers)

1. **R4 detection is in the wrong layer.** The bridge cannot evaluate "no resolvable reply-thread" because the thread registry is host-owned (`data/thread-registry.json` per PRD 10-2100). TMCP can detect "no owned reply target" via `getMessageOwner`, but that is not the same as "no matching thread in the host's registry." Architecture required: ambiguous-message detection must be host-side — the host emits a structured event and the bridge reacts, not the bridge infers. *(Engineer, Architect)*

2. **`profile/tier` has no authorization gate.** Any session (including `gather`-capability children) can call `profile/tier: skilled-router` to suppress breadcrumbs permanently. Not in `GATHER_BLOCKED`. Must be gated to root sessions only (sessions with no `parent_sid`) before the action can ship. *(Security Auditor)*

3. **Breadcrumb envelope is indistinguishable from `child/forward` injections.** `child/forward` delivers arbitrary strings as `event: "service_message" / from: "system"` — same envelope as bridge-authoritative R1/R2/R3. A compromised parent can forge R2 with malicious action signatures; the unskilled host follows them without verification. Requires a trusted-origin discriminator on bridge-authoritative messages (e.g., `bridge_authoritative: true` flag set only by internal delivery paths) or a restricted namespace for the `onboarding_subsession_*` event types. *(Security Auditor)*

4. **Bridge as capability registry is an architectural anti-pattern.** The tier field embeds host-capability knowledge in the transport layer. Parallel to `child_capability` with no defined relationship or resolution rule. As capability dimensions grow, both systems will diverge. Requires a decision: either host self-advertises capability (bridge reads it, doesn't own it) or the tier field is formally positioned as a subset view of the PRD 10-2100 capability model with explicit precedence rules. *(Architect)*

### Simplicity (non-blocking — trim before v0.2)

Remove: verbatim operator quote, Prior Art section (commit history, not spec), Tier definitions section (duplicates R5/R7/B1/B5), "The pattern works." sentence, Resolved defaults section (duplicates Requirements), Open question 2 (already answered by B1), AC1–AC7 placeholder, most of Out of scope list (retain only C4 prerequisite and "router skill" references).

## Curator stamp

- **Reviewer:** Curator
- **Date:** 2026-05-23
- **Verdict:** v0.1 ready for swarm vet by Overseer
- **Reviewed version:** v0.1
- **Action:** Initial substantive capture of the governor-split + breadcrumb-injection concept that operator outlined in voice msgs 59314-59335 (2026-05-22 evening, shipped as monitor-breadcrumb) + 60091 (2026-05-23 morning, extended pattern to unskilled-host sub-session handling). Synthesis from TMCP log archive `data/logs/2026-05-22T184524.json` + `data/logs/2026-05-23T091051.json`. Task #15's title "Governor split" was insufficient capture; this spec is the proper substance. 2 BLOCKERs distilled with Curator defaults.

## v0.2 Changes

**Redesigned by Curator 2026-06-21 addressing all 4 critical Overseer findings.**

### Critical fixes

**Issue 1 — R4 detection moved to host layer.**
Removed bridge-side ambiguous-message inference entirely. Bridge cannot evaluate thread-registry state; that is host-owned. R4 is now a host-emitted action: `action(type: 'session/request-guidance', guidance_type: 'subsession-routing')`. Bridge reacts to this explicit request rather than inferring from message characteristics. This also resolves the Obvious Action #1 (vacuously-true trigger): the host only emits this when it has actually determined a message is unroutable.

**Issue 2 — `profile/tier` gated to root sessions only.**
New Constraint C5 gates the `profile/tier` action to sessions where `parent_sid === null`. Child sessions receive `PERMISSION_DENIED`. New AC7 verifies this gate. This resolves the Security Auditor's finding that child sessions could suppress parent breadcrumbs.

**Issue 3 — Breadcrumb envelope gets trusted-origin discriminator.**
All bridge-authoritative service message deliveries (R1/R2/R3) now set `bridge_authoritative: true`. Child/forward payloads set `bridge_authoritative: false` (or omit). Documented in R1/R2/R3 and enforced by new AC8.

**Issue 4 — `profile/tier` explicitly not an independent capability registry.**
New Constraint C6 positions `profile/tier` as a breadcrumb-suppression-only signal that is a subset view of the PRD 10-2100 capability model. Precedence rule documented: full PRD capability model takes precedence; `profile/tier` is the lightweight fallback for simpler deployments.

### Obvious action fixes

- **R2/R3 timing:** R1 and R2 are now explicitly enqueued as a pair in the same batch (not sequenced across DQ calls). R3 fires on parent-issued `session/revoke-child` or sub-session lifetime end — no phantom `thread/resolved` action. `r1_pending_r2` state flag eliminated.
- **One-shot durability:** R6 now requires `subsession_guidance_delivered` flag to be written to durable session store (not in-memory only). Compaction/restart recovery: absent flag = not-yet-delivered (safe re-arm). AC5 updated to include restart verification.
- **C1/AC6 contradiction resolved:** C1 now correctly acknowledges the two new actions (`session/request-guidance` and `profile/tier`).

### Simplicity cleanup

- Removed: verbatim operator quote, Prior Art section, Tier definitions section, "The pattern works." sentence, Resolved defaults section.
- Collapsed OQ2 (already answered by B1 — default is unskilled); retained as the single remaining OQ1 decision point.
- Overseer bounce section retained verbatim as audit trail.
