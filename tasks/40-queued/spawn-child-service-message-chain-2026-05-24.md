---
id: spawn-child-service-message-chain-2026-05-24
title: Spawn-child service message chain (host + sub-agent breadcrumbs)
status: queued
version: v0.3
target: Telegram-Bridge-MCP
delegation: Foreman-routable after swarm review
author: Curator Prime
swarm_review:
  v0.1: NEEDS-REVISION (2026-05-24, 5 reviewers — devils-advocate, architect, security-auditor, engineer, simplicity-lover)
  v0.2: 3 PASS (architect, security, simplicity), 2 NEEDS-REVISION (devils-advocate, engineer) on internal-consistency only
  v0.3: STAMPED-BY-CURATOR 2026-05-24 (recordOutgoing hook named; exit_status added to R6; CAPABILITY_DENIED code; revoke-child schema description; child_token clarified as dispatch token not SID; R7 sweeper removed per operator simplification; ROLE no longer re-tells sub-agent its token — host already passed it)
stamp: "Curator Prime, 2026-05-24 — swarm-reviewed (2 rounds, 5 reviewers each), iterated v0.1->v0.2->v0.3, operator-directed simplifications applied. Ready for Foreman pickup."
sources:
  - operator voice msgs 2026-05-22 to 2026-05-24 (recovered from logs)
  - .curator-pod/memory/dispatches/spawn-child-breadcrumb-recovery-2026-05-24.md
  - .curator-pod/memory/dispatches/swarm-devils-advocate-spawn-child-2026-05-24.md
  - .curator-pod/memory/dispatches/swarm-architect-spawn-child-2026-05-24.md
  - .curator-pod/memory/dispatches/swarm-security-spawn-child-2026-05-24.md
  - .curator-pod/memory/dispatches/swarm-engineer-spawn-child-2026-05-24.md
  - .curator-pod/memory/dispatches/swarm-simplicity-spawn-child-2026-05-24.md
related:
  - electrified-cortex/Telegram-Bridge-MCP/tasks/10-drafts/sub-session-presentation-cleanup-2026-05-22.md
  - electrified-cortex/Telegram-Bridge-MCP/tasks/10-drafts/governor-split-with-unskilled-breadcrumb-injection-2026-05-23.md
  - electrified-cortex/Telegram-Bridge-MCP/tasks/10-drafts/10-2100-threaded-conversations-prd.md
---

# Spawn-child service message chain

## Purpose

Make the unskilled host agent self-bootstrapping when it spawns a sub-session, and make the sub-agent self-bootstrapping when it first dequeues. Bridge-injected service messages guide both. No pre-loaded skill required.

Operator priority (voice 60362, 2026-05-24): functional piece first; haiku-router and skilled-governor work is later.

## Scope

This spec adds two new behaviors and one schema field to TMCP:

1. Three child onboarding service messages, fired on the sub-agent's first `dequeue(token: <child_token>)`.
2. One parent notification (`CHILD_FIRST_DEQUEUE_CONFIRMED`), fired into the parent's queue when the sub-agent's first dequeue is observed.
3. One envelope discriminator (`origin: "bridge" | "child_forward"`) on `EventContent`, to make bridge service messages distinguishable from child-forwarded text at consumption time.

Prior art already shipped in commit `eb8bcab7` (SPAWN_CHILD_SUBAGENT_HINT, spawn-child response hint) and in commit `4d1bac64` (session-onboarding breadcrumb chain) is **not modified** by this spec — it is the surface this spec extends.

**Out of scope** (filed elsewhere):
- Sub-session visual presentation (topic chip, no-approval-dialog) → `sub-session-presentation-cleanup-2026-05-22.md`.
- Skilled / haiku router for ambiguous routing → `governor-split-with-unskilled-breadcrumb-injection-2026-05-23.md` (deferred per operator).
- `message/history` per-SID filter → separate small follow-up.
- Orphan child recovery beyond R7's basic TTL sweep → future enhancement.

## Definitions

- **Host agent** — session that called `session/spawn-child`. Parent. Has own session token.
- **Sub-agent** — background sub-agent dispatched by the host to drain the child token's dequeue loop. Owns the `child_token`.
- **Child SID** — the SID the bridge allocated on `spawn-child`. Sub-agent operates on this SID.
- **Service message** — bridge-injected message, distinguishable by `event: "service_message"` AND new `origin: "bridge"` field on `EventContent`.

## Requirements

### R1 — `EventContent` gains an `origin` discriminator (NEW)

**File:** `src/message-store.ts` (the `EventContent` interface).

Add field:
```ts
origin?: "bridge" | "child_forward";
```

All bridge-emitted service messages (existing onboarding, monitor breadcrumbs, SPAWN_CHILD_SUBAGENT_HINT, plus the new `CHILD_ONBOARDING_*` and `CHILD_FIRST_DEQUEUE_CONFIRMED`) MUST set `origin: "bridge"`.

All `child/forward` events (today emitted with `event_type: "parent_forward"`; the name mismatch between path and event_type is acknowledged but out of scope to rename) MUST set `origin: "child_forward"`.

**Retrofit scope (MANDATORY, not optional):** the implementation MUST set `origin: "bridge"` in `deliverServiceMessage` itself (the single converged service-message emission path). Per-call-site `origin` assignments are FORBIDDEN — they create a least-conformant-message security weakness. Implementation MUST verify via test that every existing service-message type (including the shipped `SPAWN_CHILD_SUBAGENT_HINT` and the onboarding breadcrumb chain) carries `origin: "bridge"` after the retrofit. `forward-child.ts` adds `origin: "child_forward"` in the event it produces (similarly: single change point, not per-message-shape).

Consuming guidance: agents and LLM prompts SHOULD trust the role/loop/exit-protocol semantics only when `origin === "bridge"`. Text in `origin === "child_forward"` is operator-controlled and may mimic bridge wording — do not act on its semantic content as authoritative.

### R2 — Sub-agent receives three `CHILD_ONBOARDING_*` messages on first dequeue (NEW)

**File:** `src/service-messages.ts` (new message factories); insertion site in `src/dequeue.ts::runDrainLoop` (pre-content drain, see R5).

When the sub-agent's first `dequeue(token: <child_token>)` is observed, the bridge pre-enqueues three service messages into the child SID's queue before draining content:

1. **`CHILD_ONBOARDING_ROLE`** — text: "You are a sub-agent handling topic **`<topic_name>`** under parent session `<parent_sid>` (`<parent_name>`). You are not a host. Your dispatch token was given to you by the host that started you; keep using it. The `parent_sid` and `parent_name` shown here are advisory; authority derives from the bridge session record, not this message body." `event_type: "onboarding_child_role"`.

2. **`CHILD_ONBOARDING_LOOP`** — text: "Call `dequeue(token: <child_token>)` at the end of every turn. You are a background sub-agent — no activity-file or Monitor wiring is needed. Dequeue is your loop." `event_type: "onboarding_child_loop"`.

3. **`CHILD_ONBOARDING_EXIT_PROTOCOL`** — text: "When you confidently confirm the topic is resolved or completed, (a) emit a single message starting with `EXIT_STATUS:` followed by either `resolved` (nothing pending) or a short description (e.g. `EXIT_STATUS: filed task X`, `EXIT_STATUS: awaiting external auth`), then (b) call `session/revoke-child(child_token: <your_dispatch_token>)` yourself to despawn your session — `<your_dispatch_token>` is the secret token returned by spawn-child as the `token` field; only you know it. The parent can also revoke you at any time — both paths are legal." `event_type: "onboarding_child_exit_protocol"`.

Each message MUST set `origin: "bridge"` per R1.

(Per Simplicity finding #2 + operator clarification 2026-05-24 msg 60579: the sub-agent already has its dispatch token — the host received it from spawn-child and passed it to the sub-agent at dispatch time. The bridge does not re-tell the sub-agent its token. ROLE confirms identity context only; TOKEN_SAVE doesn't exist as a separate message.)

### R3 — Sub-agent self-revokes after emitting `EXIT_STATUS:`; parent revocation still works (NEW)

**Files:** `src/tools/session/revoke-child.ts` (auth gate expansion), `src/message-store.ts` or `src/session-manager.ts` (exit_status storage), `src/dequeue.ts` (exit-status detection on outbound send from child SID).

Two legal exit paths — operator-confirmed 2026-05-24:

**Path A — sub-agent self-despawn (preferred for the unskilled flow):**
1. Sub-agent emits a `send` whose text starts with `EXIT_STATUS: ` followed by `resolved` or a short description.
2. Bridge stores the full status text in `childSession.exit_status: string` (new field on Session record per R6).
3. Sub-agent calls `session/revoke-child(child_token: <own_dispatch_token>)`. The `child_token` parameter is the secret token the sub-agent received from spawn-child — NOT its SID. Only the sub-agent holds this token (security boundary). The bridge accepts this call when the token resolves to the calling session's own identity (self-revocation), in addition to the existing case where the caller is the registered parent. Authorization check in `revoke-child.ts` resolves `child_token` to a SID and compares against both `registeredParent` and `callerSid` (where `callerSid === resolvedChildSid` for self-revocation): `if (callerSid !== registeredParent && callerSid !== resolvedChildSid) return UNAUTHORIZED`.
4. **Existing `revoke-child.ts` parameter audit:** the current parameter named `child_token` is documented in the tool schema as "SID of the child session." If this is implemented as SID-shaped (not token-shaped), implementation MUST migrate to true token-based revocation OR document the schema as accepting "the sub-agent's identity token" (whatever the bridge convention is for that). The choice is implementation-side; the spec's invariant is that the parameter MUST be something only the sub-agent knows (and the spawning parent knows via the spawn-child response).
5. The existing `revoke-child` tool schema description MUST be updated to reflect that either the spawning parent OR the child itself can call this — otherwise sub-agents reading their tool documentation will believe self-revoke is forbidden and avoid it.
6. Bridge fires `CHILD_SESSION_RESOLVED` into the parent's queue: "Sub-agent on sid=`<child_sid>` (`<child_name>`) exited. Exit status: `<exit_status>`." `event_type: "child_session_resolved"`, `origin: "bridge"`.

**Path B — parent revokes the child (existing behavior, preserved — but discouraged while sub-agent active):**
- Parent calls `session/revoke-child(token: <child_token>)`. Authorization passes via the existing `caller === registeredParent` branch. No code change required.
- If the child had previously emitted `EXIT_STATUS: ...` but not yet self-revoked, the stored `exit_status` is still delivered to the parent via `CHILD_SESSION_RESOLVED` on revocation.
- **Use with care (operator-confirmed 2026-05-24 msg 60558):** If the background sub-agent is still actively running and has not signaled exit, parent revocation severs it mid-conversation. Operator: "the host agent is at risk... if the background agent is still running, it's probably a bad idea." Reserve parent revocation for orphan cleanup, hung sub-agents, or operator-directed abort. The PREFERRED exit path is sub-agent self-revoke (Path A).

**Detection of `EXIT_STATUS:`:** The bridge inspects outbound message text via the `recordOutgoing` function in `src/message-store.ts` (the single converged write-path for outbound events). When `recordOutgoing` is called from a session that has `parent_sid` set AND the text matches `/^EXIT_STATUS: /`, the matched portion (after the prefix) is stored on `childSession.exit_status`. The `send` itself proceeds normally to whatever target_sid the sub-agent specified (typically operator-visible — meaning the literal `EXIT_STATUS: ...` text WILL appear in the operator's Telegram view; sub-agent skills should be aware this is operator-visible). The status capture is a side-effect of inspection.

**Scope guard:** detection applies only to messages originating from a session with `parent_sid` set (i.e., sub-sessions). Top-level sessions emitting `EXIT_STATUS:` text are unaffected. The behavior is bounded to the spawn-child topology and does not silently expand to other multi-agent shapes.

The parent can retrieve `exit_status` from the child session record via existing `session/list` or future `child/status` action. Adding a dedicated `child/status` action is out of scope for THIS spec.

### R4 — `CHILD_FIRST_DEQUEUE_CONFIRMED` fires to parent only (NEW)

**Files:** `src/dequeue.ts::runDrainLoop`, `src/session-manager.ts` (durability — see R6).

When `dequeue(token: <child_token>)` is called and:
- the SID has `parent_sid` set, AND
- `firstDequeueOccurred === false` for that SID,

then the bridge MUST:

1. Set `firstDequeueOccurred = true` for that SID (persistent — see R6).
2. Pre-enqueue the three `CHILD_ONBOARDING_*` messages (R2) into the child SID's queue, BEFORE draining content. They arrive in the same dequeue response as any content already pending.
3. Direct-deliver `CHILD_FIRST_DEQUEUE_CONFIRMED` to the parent SID's queue (NOT broadcast; `target_sid = parent_sid`, no governor visibility). Text: "Your sub-agent on sid=`<child_sid>` (`<child_name>`, topic `<topic_name>`) is alive — first dequeue observed." `event_type: "child_first_dequeue_confirmed"`, `origin: "bridge"`.

**Edge case — parent session gone:** If `parent_sid` is no longer an active session at the moment of fire, step 3 is silently skipped (logged at debug level). Steps 1-2 still run normally — the sub-agent receives its onboarding regardless of parent liveness.

**Edge case — child receives ZERO dequeue:** see R7.

### R5 — Injection point in `runDrainLoop` is the non-content drain phase (NEW)

**File:** `src/dequeue.ts::runDrainLoop`.

The first-dequeue detection + onboarding injection MUST happen in `runDrainLoop` (the function shared by both the MCP tool handler and the HTTP `/dequeue` endpoint), at the non-content drain phase, BEFORE the content drain.

Concretely: at the top of `runDrainLoop`, after token resolution but before any content read, check `session.parent_sid && !session.firstDequeueOccurred`. If true, run R4 steps 1-3.

This guarantees: (a) HTTP and MCP paths both fire, (b) the three onboarding messages arrive in the same response batch as any pending content, (c) ordering is deterministic.

### R6 — Session record gains `firstDequeueOccurred` and `exit_status` (NEW)

**File:** `src/session-manager.ts` (`Session` interface).

Add two fields to the `Session` interface (next to `firstUseHintsSeen`):
```ts
firstDequeueOccurred?: boolean;
exit_status?: string;
```

`firstDequeueOccurred` gates R4. `exit_status` stores the post-`EXIT_STATUS:` payload from R3.

Both fields live in the same in-memory session record as everything else. Bridge restart is not a concern — operator-confirmed 2026-05-24 (msg 60564): "if the bridge restarts, everything's over... it's a non-concern. It's dead. This is an in-memory process, period." If the bridge restarts, the session itself is gone too; there is no child SID to re-inject onboarding for, and no `exit_status` to recover.

### R7 — REMOVED (deferred)

Operator-directed 2026-05-24 (msg 60578): the TTL sweeper + bridge-internal authority bypass adds surface area not warranted for v0.1. If a sub-agent never dequeues, the host sees the absence of `CHILD_FIRST_DEQUEUE_CONFIRMED` and can re-dispatch manually. Orphan recovery via automatic sweeper is filed as a future enhancement, not a v0.1 requirement.

### R8 — `gather` capability blocks `session/spawn-child` (NEW)

**File:** `src/tools/session/spawn-child.ts` (auth check inside the tool, NOT only at the dispatch path).

`spawn-child.ts` MUST reject calls when the caller's `capability !== "full"`. The check MUST live inside `spawn-child.ts` itself — not only in `action.ts`'s dispatch path — to cover both action-dispatched calls and direct MCP tool calls.

Returns `code: "CAPABILITY_DENIED"` on rejection (matching the existing error-code convention used elsewhere in the codebase, NOT a new `INSUFFICIENT_CAPABILITY`).

Tests MUST cover BOTH the action-dispatch path and the direct MCP tool call path.

## Acceptance criteria

- **AC1** — All bridge-injected service messages carry `EventContent.origin === "bridge"`. All `child/forward` events carry `EventContent.origin === "child_forward"`. (Test: dispatch each path and inspect `origin`.)
- **AC2** — On the sub-agent's first dequeue (no prior `dequeue` calls on the child token), the response carries three service messages with `event_type`s `onboarding_child_role`, `onboarding_child_loop`, `onboarding_child_exit_protocol`, in that order, ahead of any content events.
- **AC3** — On the sub-agent's second dequeue, none of the `onboarding_child_*` events appear (idempotency).
- **AC4** — On the sub-agent's first dequeue, the parent SID receives a `child_first_dequeue_confirmed` event exactly once (per child SID lifetime). Parent SID dequeue returns it; no other SID (including governor) receives it.
- **AC5a** — When the sub-agent sends a message whose text starts with `EXIT_STATUS: `, the child session's `exit_status` field is populated. The send itself completes normally.
- **AC5b** — When the sub-agent calls `session/revoke-child(child_token: <own_dispatch_token>)`, the call succeeds (self-revocation is authorized when the token resolves to the calling session's own SID).
- **AC5c** — When EITHER the sub-agent self-revokes OR the parent revokes, the parent SID receives `child_session_resolved` carrying the stored `exit_status` (if one was emitted before revocation; otherwise empty).
- **AC5d** — Parent calling `session/revoke-child` continues to work via the existing `callerSid === registeredParent` auth path (no regression).
- **AC6** — REMOVED with R7.
- **AC7** — `session/spawn-child` called by a session with `capability !== "full"` returns `CAPABILITY_DENIED`. Tested via BOTH the action-dispatch path AND the direct MCP tool path.
- **AC8** — Both MCP-tool dequeue and HTTP `/dequeue` paths fire R4 and R2 identically. (Test the HTTP path explicitly.)

## Behavioral flow

```
Host ----------------------------- Bridge ---------------------------- Sub-agent
  |  spawn-child(name, topic)        |                                       |
  | -------------------------------> |                                       |
  |                                  | (cap check per R8)                    |
  | <--- {child_token, sid,          |                                       |
  |       parent_sid,                |                                       |
  |       hint:"call dequeue..."}    |                                       |
  |                                  |                                       |
  |  dequeue(parent_token)           |                                       |
  | -------------------------------> |                                       |
  | <--- SPAWN_CHILD_SUBAGENT_HINT  |                                       |
  |       (origin:"bridge", existing)|                                       |
  |                                  |                                       |
  | [dispatches background sub-     |                                       |
  |  agent with child_token]        |                                       |
  |                                  |        dequeue(child_token) [1st]    |
  |                                  | <------------------------------------ |
  |                                  | (R5 check: parent_sid && !firstDeq)  |
  |                                  | --> CHILD_ONBOARDING_ROLE             |
  |                                  | --> CHILD_ONBOARDING_LOOP             |
  |                                  | --> CHILD_ONBOARDING_EXIT_PROTOCOL    |
  |                                  | (set firstDequeueOccurred=true)      |
  |                                  | (drop CHILD_FIRST_DEQUEUE_CONFIRMED  |
  |                                  |  into parent's queue, if alive)      |
  | <--- CHILD_FIRST_DEQUEUE_         |                                       |
  |       CONFIRMED                  |                                       |
  |                                  |                                       |
  |                                  |        ...turn loop...                |
  |                                  |                                       |
  |                                  |        send("EXIT_STATUS: resolved")  |
  |                                  | <------------------------------------ |
  |                                  | (R3: recordOutgoing captures          |
  |                                  |  EXIT_STATUS into childSession        |
  |                                  |  .exit_status; send proceeds normally)|
  |                                  |                                       |
  |                                  |        session/revoke-child(          |
  |                                  |          child_token:                 |
  |                                  |          <own_dispatch_token>)        |
  |                                  | <------------------------------------ |
  |                                  | (auth gate: token resolves to        |
  |                                  |  callerSid, matches; revoke succeeds.|
  |                                  |  fire CHILD_SESSION_RESOLVED to      |
  |                                  |  parent with stored exit_status)     |
  | <--- CHILD_SESSION_RESOLVED      |                                       |
```

## Limitations (not ACs)

- **L1** — Parent retrieval of full sub-session transcript requires `message/history` per-SID filter (separate follow-up spec).
- **L2** — Orphan recovery beyond R7's 5-minute TTL is not addressed; a child that crashes mid-conversation (after `firstDequeueOccurred = true`, before `EXIT_STATUS`) is not auto-cleaned.
- **L3** — TMCP session state is in-memory only. Bridge restart kills all sessions, tokens, and flags. The ONLY durable surface is the Telegram message log, written async on every message (including sub-session messages). Operator can recover the *conversation* of a dead sub-session by reading logs; cannot recover its *runtime state*. No persistence concerns in scope for this spec.

## Status sequence (per operator's 2026-05-24 directive)

```
P0 (this spec):  R1-R8  — sub-agent onboarding + parent confirmation + envelope discriminator + cascade cap
P1 (sibling):    sub-session-presentation-cleanup v0.3  (13 Overseer bounces to resolve)
P2 (follow-up):  message/history per-SID filter
P3 (follow-up):  child/status action for programmatic exit_status retrieval
DEFERRED:        governor-split unskilled/skilled router
```

## Swarm verdict — v0.1 (2026-05-24)

| Reviewer | Verdict | Blocking findings count |
|---|---|---|
| Devil's Advocate | NEEDS-REVISION | 3 |
| Architect | NEEDS-REVISION | 4 |
| Security Auditor | NEEDS-REVISION | 4 |
| Engineer | NEEDS-REVISION | 3 |
| Simplicity Lover | NEEDS-REVISION | 0 (cleanup only) |

### Convergent blockers addressed in v0.2

1. **In-memory `firstDequeueOccurred` durability** (DA1, Arch1, Eng1, Sec5) — operator-clarified 2026-05-24 (msg 60564) as a non-concern: TMCP is in-memory only; bridge restart kills sessions entirely, so a re-injection scenario cannot occur. R6 names the field on the Session record next to `firstUseHintsSeen`; no persistence layer.
2. **`revoke-child` auth gap** (Arch6, Sec8) — operator clarified 2026-05-24 (msgs 60556 + 60557): BOTH parent and sub-agent should be able to revoke. v0.2 R3 expands the auth gate in `revoke-child.ts` to accept `callerSid === childSid` (self-revocation) in addition to the existing `callerSid === registeredParent`. Sub-agent emits `EXIT_STATUS:` THEN calls `session/revoke-child` itself.
3. **`origin` field undefined / unimplemented** (DA3, Arch5, Eng3, Sec1) — R1 names the field as new on `EventContent`, specifies retrofit scope.
4. **First-dequeue detection insertion point** (Arch3, Eng2) — R5 names `runDrainLoop` non-content phase.
5. **Parent-gone behavior** (DA2, Arch2, Eng4) — R4 edge case spelled out.
6. **`CHILD_FIRST_DEQUEUE_CONFIRMED` visibility leak** (Sec4) — R4 specifies parent-targeted delivery; not broadcast.
7. **Spawn cascade cap** (Sec6) — R8.
8. **No-first-dequeue orphan** (DA5) — R7 TTL sweep.
9. **Exit status retrieval mechanism** (DA6, Sec3) — R3 stores `exit_status` on Session record; parent can fetch.

### Simplicity findings addressed in v0.2

- R1/R2 inflation collapsed — Scope section references shipped commits, no inert requirement entries.
- Four messages reduced to three (ROLE+TOKEN_SAVE merged).
- LOOP wording tightened (no double negative).
- Q1/Q2 removed (decisions baked in).
- Q3 (deeplink) explicitly out of scope.
- "Curator notes" section removed (moved context to swarm verdict section).
- AC7 (transcript retrieval) became L1 limitation.
- Duplicate out-of-scope section dropped.

### Findings still open / not addressed (track for v0.3 or implementation)

- **DA4 (token tautology)** — partially addressed by removing TOKEN_SAVE; the token in ROLE is still informational, not a security claim. Acceptable.
- **Arch4 + Eng4 (function signature for dynamic templates)** — left for implementation; templates use the existing service-message factory pattern.
- **Sec2 + Sec3 (mimicry attack on ROLE body via child/forward)** — partially mitigated by R1's `origin` discriminator + the guidance that `parent_sid` is advisory. Full mitigation would require sub-agents to verify the bridge-source by querying session/list rather than trusting message text. Tracked as L4 (new limitation) — sub-agents should be guided by skill to verify identity via session/list, not trust the text alone. Out of scope for this spec.
- **Sec7 (token "do not share" misleading)** — wording in ROLE is informational; no operational claim made.
- **Sec9, Sec10 (nits)** — accepted as written.


## Overseer review

- **Reviewer:** Overseer (SID 3)
- **Date:** 2026-05-24
- **Verdict:** PASS
- **Review type:** adversarial-manual (light-scan; Curator swarm pre-verified — 2 rounds, 5 reviewers each, v0.1→v0.3 iteration)

**Checked:**
- Acceptance criteria: all 8 active ACs (AC1–AC5d, AC7–AC8) are binary and testable with explicit test guidance
- Scope: bounded; 3 changes + 1 schema field; out-of-scope items explicitly named with pointers to sibling specs
- Delegation: Foreman-routable after swarm review — correct; task is in 40-queued with Curator stamp
- Open questions: none blocking; DA4/Arch4/Eng4/Sec2/Sec3 resolved or explicitly deferred to implementation or L-tracked limitations
- R7 removal: operator-directed simplification applied cleanly; AC6 correctly marked REMOVED
- Authorization model (R3/R8): self-revocation path and CAPABILITY_DENIED gate are both implementable and tested per AC5b, AC7
- In-memory-only constraint (R6): operator-confirmed; no persistence layer needed; correctly documented

**Not checked:**
- TypeScript implementation correctness (left to worker + foreman review)
- Test coverage completeness beyond what ACs specify
- Performance characteristics of ecordOutgoing inspection on high-volume sessions
