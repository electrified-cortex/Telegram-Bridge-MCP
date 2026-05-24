---
title: Governor split — unskilled tier gets breadcrumb-service-message guidance for sub-session handling
stage: 10-drafts
author: Curator (synthesized from operator voice msgs 60091 + 59314-59335)
date: 2026-05-23
target_repo: electrified-cortex/Telegram-Bridge-MCP
priority: PRI-1
related:
  - tasks/10-drafts/10-2100-threaded-conversations-prd.md (downstream skill suite that uses this pattern)
  - tasks/10-drafts/sub-session-presentation-cleanup-2026-05-22.md (presentation layer prerequisite)
  - Curator task #15 (Governor split label; this spec is the substantive expansion)
version: v0.1
---

# Governor split: unskilled tier gets breadcrumb-service-message guidance

## Problem

The threaded-conversations PRD (10-2100) assumes either (a) a skilled host with a haiku-driven router skill OR (b) a degraded manual mode where the operator drives thread creation explicitly. Missing: the **middle tier** — an unskilled host that doesn't have a router skill but CAN handle sub-sessions if the bridge tells it how, via the same breadcrumb-style service messages that already work for the monitor onboarding chain (shipped 2026-05-22 via `ACTIVITY_FILE_MONITOR_INSTRUCTIONS` + post-registration enqueue).

Operator's framing (2026-05-23T20:11Z, voice msg 60091): "the unskilled governor can still do its job and take advantage of subsessions, but the skilled governor can even do crazier things, like use a haiku for routing. It's the ambiguousness of incoming messages that need to be routed, but that still pollutes the host context, which can confuse the host. I just want to make sure that the unskilled host agent understands what to do by getting all the right Telegram service messages."

## Prior art (proves the pattern)

Last night (2026-05-22 ~8pm PT, msgs 59314-59335), the monitor onboarding breadcrumb chain was designed and shipped:

1. `session/start` returns hint: "call dequeue now"
2. First DQ delivers two service messages:
   - "Always call dequeue at the end of every turn." (`ONBOARDING_LOOP_PATTERN`)
   - "If you have a Monitor tool, call `activity/file/create`." (`ONBOARDING_ACTIVITY_FILE_HINT`)
3. Agent calls `activity/file/create`. Response hint: "your next dequeue carries the monitor invocation"
4. Next DQ delivers `ACTIVITY_FILE_MONITOR_INSTRUCTIONS` — the actual `monitor.ps1` / `monitor.sh` command with the file path

Each message points to the next action. Nothing dumped in one shot. Agent follows the breadcrumb chain to a fully-armed monitor without needing a skill file.

**The pattern works.** This task extends the same pattern to sub-session handling for the unskilled host.

## Goal

When the unskilled host receives an ambiguous inbound message that would benefit from sub-session routing, the bridge injects breadcrumb-style service messages teaching the host: when to spawn a sub-session, how to forward the inbound message to it, and what the host's own role is (orchestrator, not content-processor).

Unskilled host can drive the threaded-conversations pattern from breadcrumbs alone — no skill file required. Skilled host (with haiku-driven router skill) bypasses the breadcrumbs because the router handles classification natively.

## Tier definitions

**Unskilled tier (default)**:
- Host has no router skill
- Host receives breadcrumb service messages from TMCP on first ambiguous-message detection
- Host follows breadcrumbs: spawn-child → child/forward → child-resolves → revoke-child
- All routing decisions are explicit (host chooses topic_label per message)
- Higher per-message tool-call cost, simpler architecture

**Skilled tier (opt-in)**:
- Host has loaded a router skill (per PRD 10-2100, OQ1 file location)
- Bridge detects router-skill presence via host's `profile/topic` or explicit `profile/tier` action (TBD which mechanism)
- Bridge suppresses the unskilled breadcrumbs
- Host uses haiku-driven router for classification, native sub-session orchestration
- Lower per-message cost, more architecture

Bridge tier detection: implementer's call (see Resolved defaults).

## Requirements

R1. **New service message: `ONBOARDING_SUBSESSION_HOST_ROLE`** — delivered on first ambiguous-message detection to unskilled hosts. Explains: "You may receive inbound messages that aren't a reply to a known thread. Route these by spawning a sub-session (`session/spawn-child`) and forwarding via `child/forward`. The sub-agent handles content; you stay context-clean."

R2. **New service message: `ONBOARDING_SUBSESSION_SPAWN_BREADCRUMB`** — delivered after R1 on next DQ. Explains the spawn-and-forward sequence with the exact action signatures + parameter names. Following this breadcrumb, the unskilled host can spawn a sub-session and forward the inbound message without any other guidance.

R3. **New service message: `ONBOARDING_SUBSESSION_RESOLVE_BREADCRUMB`** — delivered when a sub-session signals `thread/resolved` (or equivalent terminal state). Explains: "Sub-agent reported done. Call `session/revoke-child` to clean up. Free your slot."

R4. **Ambiguous-message detection** (bridge-side) — TMCP detects when an inbound message has no `reply_to_message_id` that maps to a known thread sub-session under the receiving host. Threshold for "ambiguous": first such message in current session window (configurable threshold acceptable; default = 1).

R5. **Tier detection** — bridge knows whether host is unskilled or skilled. If skilled: suppress R1/R2/R3 breadcrumbs. If unskilled: deliver them.

R6. **One-shot per session.** Each breadcrumb message is delivered ONCE per host session lifetime (not on every ambiguous message). After the first delivery, host has the knowledge; further reminders only on explicit request or on a cooldown window.

R7. **Skilled hosts opt out by signaling tier.** A host that has loaded a router skill should signal `action(type: 'profile/tier', tier: 'skilled-router')` (or equivalent) at session start. Default tier on no signal = unskilled (safest — gets the guidance).

## Behavior

B1. On `session/start` for any session: tier defaults to unskilled until host signals otherwise.

B2. On first inbound message with no resolvable reply-thread: TMCP fires `ONBOARDING_SUBSESSION_HOST_ROLE` into the next DQ for the host (if unskilled).

B3. On next DQ after R1: TMCP fires `ONBOARDING_SUBSESSION_SPAWN_BREADCRUMB` with concrete action signatures.

B4. On any sub-session's terminal signal (`thread/resolved` or `session/revoke-child` from sub-session): TMCP fires `ONBOARDING_SUBSESSION_RESOLVE_BREADCRUMB` to parent (once per session lifetime).

B5. Skilled hosts (via R7 opt-out): no breadcrumbs fired; behavior unchanged from current.

## Constraints

C1. No new actions or tools required — `session/spawn-child`, `child/forward`, `session/revoke-child` already exist. This task adds only service messages + bridge-side detection.

C2. Existing `session/start` flow unchanged. Tier defaults to unskilled silently.

C3. Skilled-tier opt-out mechanism is additive (new action / profile field). Does NOT remove existing actions.

C4. Subsession-presentation-cleanup task (the P2 in 10-drafts) is a prerequisite — the breadcrumbs assume sub-sessions present as parent-with-thread-chip, not peer participants.

## Acceptance criteria

AC1. Three new service-message templates exist in `src/service-messages.ts`: `ONBOARDING_SUBSESSION_HOST_ROLE`, `ONBOARDING_SUBSESSION_SPAWN_BREADCRUMB`, `ONBOARDING_SUBSESSION_RESOLVE_BREADCRUMB`. Wording matches the breadcrumb style of `ACTIVITY_FILE_MONITOR_INSTRUCTIONS` (direct, concrete, no fluff).

AC2. Bridge fires R1 on first inbound message with no resolvable reply-thread for an unskilled host. Verified by sending an inbound message from operator to a fresh unskilled host with no prior threads.

AC3. Bridge fires R2 on the next DQ after R1. Verified by inspecting the host's queue contents after R1 was acknowledged.

AC4. Bridge fires R3 on first `thread/resolved` (or equivalent terminal signal). Verified by spawning a sub-session, completing it, then inspecting parent's queue.

AC5. Each breadcrumb message delivered EXACTLY ONCE per host session lifetime. Second ambiguous message does NOT re-fire R1 in the same session.

AC6. Skilled-tier opt-out: a host that signals `profile/tier: skilled-router` (or final agreed mechanism) at session start receives NO breadcrumbs. Verified by inspecting the host's queue after the same ambiguous-message scenario as AC2.

AC7. Tier defaults to unskilled when no signal received. New hosts get breadcrumbs by default.

## Out of scope

- The router skill itself (operator/skill author writes that; covered by PRD 10-2100 OQ1).
- Per-thread context persistence (covered by PRD 10-2100 OQ6, already closed).
- Sub-session presentation as parent-with-thread-chip (sub-session-presentation-cleanup task is prereq).
- Auto-classification of message content (that's the skilled tier; unskilled host classifies by reading the message itself).
- TTL / revival / closed-thread reopening (PRD 10-2100 OQ-A).
- Cross-host coordination (multiple primary sessions sharing sub-sessions) — out of scope; sub-sessions are per-parent.

## Resolved defaults (Curator-applied 2026-05-23, override at will)

- **Tier detection mechanism**: NEW action `action(type: 'profile/tier', tier: 'skilled-router' | 'unskilled')`. Default unskilled. Could alternatively use a profile field on `session/start`; this is implementer's call. Either way, opt-in to skilled, default to unskilled.
- **Breadcrumb cooldown**: one-shot per session lifetime (R6). No periodic re-arming. Operator can manually re-trigger if needed via explicit request action (not in this scope).
- **"Ambiguous" detection threshold**: first inbound with no resolvable reply-thread fires the breadcrumb chain. Simple, no per-session config.
- **Wording style**: match `ACTIVITY_FILE_MONITOR_INSTRUCTIONS` — direct, action-oriented, no preamble.

## Open questions (BLOCKERS — operator decision needed)

1. **[BLOCKER] Tier detection: new action vs profile field on session/start?** Default proposed: new action `profile/tier`. Reasoning: opt-in pattern matches other profile actions; doesn't bloat session/start signature. Confirm or override.

2. **[BLOCKER] Default tier for hosts existing before this lands.** Default proposed: existing hosts are unskilled retroactively (they get the breadcrumbs on their next first-ambiguous-message). Reasoning: safer; teach existing fleet rather than assume skill presence. Confirm or override.

## Evidence

- Voice msg 60091 (2026-05-23T20:11:13Z): operator outlined the unskilled/skilled split.
- Voice msgs 59314-59325 (2026-05-22T~03:00Z, ~8pm PT): operator designed the breadcrumb chain pattern for monitor onboarding. Pattern shipped.
- Curator's response 60092 (2026-05-23T20:11:48Z): "Governor-split note filed as task #15" — but the substantive breadcrumb-injection mechanism was NOT captured in task #15's title alone. This spec is the substantive capture.

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
