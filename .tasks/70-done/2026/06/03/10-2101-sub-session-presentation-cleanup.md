---
id: 10-2101
title: Sub-session presentation — no approval dialog, parent identity, thread chip
Created: 2026-06-02
Status: 50-active
Claimant: sid:36mca0d14f0
Priority: high
Source: Curator spec sub-session-presentation-cleanup-2026-05-22.md v0.2; gaps resolved by Overseer 2026-06-02 (v2 after swarm bounce)
target_version: 7.8.1
Delegation: Worker
related: [10-2100]
---

# 10-2101 — Sub-session presentation cleanup (v2)

## Problem

`session/spawn-child` currently routes through `handleSessionStart`. A sub-session is presented to the operator as a brand-new peer session: approval dialog, "Session N — Online" announcement, pin, and the full host onboarding firehose. Empirically verified 2026-05-22.

**Intended model:** a sub-session is the parent's own work-stream isolated by topic. The operator sees ONE participant (the parent) handling many topics via topic chips.

**Sub-sessions are in-memory only.** Child sessions do not survive a server restart — same lifecycle as regular sessions. No persistence mechanism is added in this task.

## Requirements

### R1 — No approval dialog
`session/spawn-child` must NOT call `requestApproval`. The sub-session is created and registered immediately.

Implementation: Add a guard before `handleSessionStart` is called in `spawn-child.ts`. Either pass a `skipApproval: true` flag into `handleSessionStart`, or bypass `handleSessionStart` entirely for the session-creation step and call a leaner path. The approval check at `start.ts:312–323` must not fire for child sessions.

Returns: `{ token, sid, parent_sid, display_index }` — no approval wait.

### R2 — No announcement, no pin, no disconnect message
- `setSessionAnnouncementMessage` MUST NOT be called for sub-sessions.
- No `sendMessage` announcement in chat (`start.ts:382–400` — guard on `parent_sid`).
- No `pinChatMessage` for sub-sessions.
- `revoke-child` cleanup must handle the no-announcement case as a no-op (not an error).
- `session-teardown.ts:84` sends `"${sessionName} has disconnected."` to the Telegram chat for every session close. This MUST be suppressed for sub-sessions (guard on `parent_sid` before `sendServiceMessage` in teardown).

### R3 — Identity inheritance + numbered topic chip
Sub-session outbound name tag = parent name tag (same color, same name). Topic chip: `**[<topic_name> <circle_digit>]**`

- Circle digit = `String.fromCodePoint(0x245F + display_index)` — maps index 1→①, 2→②, …, 9→⑨.
- Per-parent limit: 9 concurrent sub-sessions. Index allocation is **gap-fill** (lowest free slot, 1–9). The limit counts currently-registered (not-yet-revoked) children per parent. Revoking a child frees its slot for re-use.
- The returned `display_index` is the assigned slot number (not a spawn ordinal) — it may be lower than the current child count if a prior slot was freed.
- A 10th spawn returns error `SUB_SESSION_LIMIT` with payload `{ limit: 9, current: N, parent_sid }` where N = count of currently-alive children.
- `color` param in `spawn-child` schema is now **ignored**; color is always inherited from parent. Update schema description to say "ignored — color inherited from parent."
- Slot numbering is **1-based**; valid range is 1–9 (slot 0 is invalid). Gap-fill assigns the lowest integer in 1–9 not currently occupied by an alive child.
- `getChildren(parentSid)` returns the **display_index slot numbers** (1–9) of currently-alive children — NOT their SIDs. Gap-fill is computed from this set. No separate counter needed.
- Index state is in-memory (same lifecycle as sessions — cleared on restart).

### R4 — Narrowed onboarding
Sub-sessions on first dequeue receive exactly **four** service messages using the existing `onboarding_child_*` naming convention. Extend the set with one new message; keep the existing three:

| event_type | Content |
|---|---|
| `onboarding_child_token` *(new)* | "Your token is real; save it for the duration of this dispatch." |
| `onboarding_child_role` *(existing)* | Keep existing wording |
| `onboarding_child_loop` *(existing)* | Keep existing wording |
| `onboarding_child_exit_protocol` *(existing)* | Keep existing wording |

Suppressed for sub-sessions (do NOT deliver): `onboarding_token_save`, `onboarding_loop_pattern`, `onboarding_no_pending_yet`, `onboarding_hybrid_messaging`, `onboarding_activity_file_hint`, `onboarding_protocol`, `onboarding_modality_priority`, `onboarding_presence_signals`, `behavior_nudge_first_message`, `behavior_nudge_reaction_semantics`, `compression_hint_first_dm`, `modality_hint_voice_received`.

Note on suppression scope: the lazy-firing messages (`onboarding_protocol`, `onboarding_modality_priority`, `onboarding_presence_signals`, `onboarding_hybrid_messaging`) are dispatched from `server.ts:155–163` on first dequeue returning user content — NOT from `start.ts`. The behavior nudges (`behavior_nudge_first_message`, `behavior_nudge_reaction_semantics`) fire from `behavior-tracker.ts:219`. Both of these files need `parent_sid` guards, not just `start.ts:435–440`.

### R5 — No activity-file hint or behavior nudges for sub-sessions
Sub-agents run tight dequeue loops; they do not need a file monitor and do not need host-flavored presence guidance.

## Design decisions (all gaps resolved)

**Authoritative parent/child store:** `child-registry.ts` is authoritative. Add `getChildren(parentSid): number[]` inverse query that returns the **display_index slot numbers** (1–9) of alive children (not SIDs). `Session.parent_sid` in session-manager is the read-through; child-registry is source of truth. Gap-fill = lowest integer in 1–9 not present in the returned set. No separate counter needed.

**Name-tag display rule:** Replace `activeSessionCount() < 2` threshold in `outbound-proxy.ts:38` with `primarySessionCount() < 2` where primary = sessions with `parent_sid === null`. Add `primarySessionCount()` predicate to session-manager. Sub-sessions never count as primary.

**NAME_CONFLICT bypass:** `handleSessionStart` has a case-insensitive name collision guard (`start.ts:295–307`). Sub-session topic names must bypass this guard — they are scoped to the parent, not global. Implement by either: (a) passing a `skipNameCheck: true` flag, or (b) auto-prefixing the name with `parentSid:` before the collision check, or (c) not calling the collision check path for spawn-child. Worker's choice — any approach that prevents NAME_CONFLICT on topic name reuse is acceptable.

**Recursive spawn gate:** A session with `parent_sid` set MUST receive `CAPABILITY_DENIED` on any `session/spawn-child` call, regardless of `child_capability`. Add this check in `spawn-child.ts` BEFORE the capability check. Error code: `CAPABILITY_DENIED` (not UNAUTHORIZED — that is reserved for token auth failures).

**SESSION_JOINED and governor re-election suppression:** Sub-session creation MUST NOT trigger:
- `SESSION_JOINED` delivery to peer sessions (`start.ts:410–424` — guard on `parent_sid`)
- Governor re-election logic (`start.ts:374–378` — guard on `parent_sid` before `sessionsActive === 2` check)

**profile/topic restriction:** Two paths must be gated:
1. Add `profile/topic` to `GATHER_BLOCKED` (covers the `action()` path).
2. Add `parent_sid` guard to the `set_topic` standalone MCP tool handler in `src/tools/profile/topic.ts` — return `CAPABILITY_DENIED` when calling session has a `parent_sid`.

Topic is set at spawn time from the `name` param and is immutable thereafter for child sessions.

**Cascading revocation:** When a parent session is closed (any path: `session/close`, health-check, crash-eviction), all registered child sessions must be revoked before or as part of parent teardown. Implementation: call `getChildren(parentSid)` in `closeSessionById()` in `session-teardown.ts` and revoke each child before closing the parent. Best-effort sequential (not atomic) — if the process crashes mid-cascade, orphaned children are acceptable at the in-memory level (they are cleared on restart anyway).

**Voice/animation profile:** Sub-sessions inherit the parent's voice and animation profile at spawn time. Use `getSessionVoiceFor(parentSid)` for voice. For animation, read the parent's session default and copy to child at creation.

**Error code alignment:**
- Topology/capability violations (recursive spawn, topic-immutability): `CAPABILITY_DENIED`
- Auth failures (bad token, SID mismatch): `UNAUTHORIZED`

**AC6 alignment:** `revoke-child` emits `child_session_resolved` (event type) to the parent queue — this is what the code already emits. AC6 is updated below to match.

## Acceptance criteria

- [ ] AC1. `session/spawn-child` returns `{ token, sid, parent_sid, display_index }` without awaiting operator approval. No dialog in chat.
- [ ] AC2. Chat does NOT receive "Session N — Online" announcement, no pin applied, and no "X has disconnected." teardown message. Verified by inspecting Telegram chat after spawn + after revoke.
- [ ] AC3. Message sent with sub-session token presents as parent (same color + name tag). Topic chip rendered as `**[<topic_name> ①]**` (or ②–⑨ per display_index). The display_index in the spawn response equals the circle digit index (1–9, gap-fill slot).
- [ ] AC3a. Spawning a 10th sub-session returns `SUB_SESSION_LIMIT` with `{ limit: 9, current: 9, parent_sid }`. Revoking a child frees its slot; re-spawn succeeds and recycles the freed slot index.
- [ ] AC4. Sub-session first dequeue returns exactly the four `onboarding_child_*` messages (token, role, loop, exit_protocol) and no suppressed host-onboarding event types. Verified by inspecting queue contents.
- [ ] AC5. Existing peer-session behavior unchanged. `session/start` with no parent SID still goes through approval, gets announcement, pin, and full onboarding.
- [ ] AC6. `session/revoke-child` works. Parent receives `child_session_resolved` service event. No "disconnected" chat message. No-announcement case = no-op (not error).
- [ ] AC7. A session with `parent_sid` set receives `CAPABILITY_DENIED` on `session/spawn-child`.
- [ ] AC8. Sub-session creation does NOT trigger `SESSION_JOINED` to peer sessions and does NOT trigger governor re-election.
- [ ] AC9. `primarySessionCount()` predicate exists in session-manager; name-tag display rule in `outbound-proxy.ts` uses it.
- [ ] AC10. `child-registry.ts` has `getChildren(parentSid): number[]`. Parent close cascades revocation to all children (best-effort sequential).
- [ ] AC11. `set_topic` standalone MCP tool returns `CAPABILITY_DENIED` for sessions with `parent_sid`.
- [ ] AC12. Topic name collision (same name as existing session) does not block sub-session spawn.

## Implementation touch points (worker reference — not exhaustive)

- `spawn-child.ts` — bypass requestApproval, add parent_sid recursive-spawn gate, implement display_index assignment, update SPAWN_CHILD_SCHEMA descriptions
- `start.ts:295–307` — NAME_CONFLICT bypass for child sessions
- `start.ts:312–323` — skip approval for child sessions
- `start.ts:374–378` — skip governor re-election for child sessions
- `start.ts:382–400` — skip announcement + pin for child sessions
- `start.ts:408–424` — skip SESSION_JOINED for child sessions
- `start.ts:435–440` — replace with sub-session narrowed onboarding (4 messages)
- `start.ts:444` — skip refreshGovernorCommand for child sessions (Telegram API noise)
- `session-teardown.ts:84` — skip disconnect message for child sessions
- `child-registry.ts` — add `getChildren(parentSid): number[]`
- `session-manager.ts` — add `primarySessionCount(): number`
- `outbound-proxy.ts:38` — replace `activeSessionCount()` with `primarySessionCount()`
- `service-messages.ts` — add `ONBOARDING_CHILD_TOKEN` message template
- `dequeue.ts:214–227` — add `onboarding_child_token` to child onboarding set
- `server.ts:155–163` — suppress lazy onboarding for child sessions (parent_sid guard)
- `behavior-tracker.ts:219` — suppress behavior_nudge_first_message for child sessions
- `topic-state.ts/applyTopicToText` — integrate circle digit from child-registry index
- `src/tools/profile/topic.ts` — add parent_sid guard → CAPABILITY_DENIED
- `action.ts` — add profile/topic to GATHER_BLOCKED

## Out of scope

- Threaded conversations skill suite (10-2100) — builds on top; separate tasks
- Forum topic / message_thread_id binding (iceboxed, 10-1952-T3)
- Child session persistence / crash recovery — in-memory only for 7.8.1
- Per-session child-registry persistence (durable store) — deferred
- message/history per-SID filter — separate

## Overseer review (v2)

- Reviewer: Overseer SID-3
- Date: 2026-06-02
- Verdict: PASS (v3 — all blocking gaps resolved including re-vet findings: slot-range 1-based constraint added, getChildren() return type clarified as display_index slots not SIDs)
- Review type: swarm bounce resolved + operator decisions applied
- Operator decisions: (1) onboarding naming = extend existing onboarding_child_* convention; (2) child sessions in-memory only, no persistence
- Checked: all 11 blocking/critical items from swarm addressed, error code alignment corrected (CAPABILITY_DENIED), AC6 corrected to child_session_resolved, implementation hints extended to cover server.ts + behavior-tracker.ts, NAME_CONFLICT bypass specified, teardown disconnect guard specified, SESSION_JOINED + governor re-election guard specified, set_topic standalone tool gated
- Not checked: technical correctness of implementation (worker's job post-spec)
- Next step: queue for TMCP foreman

## Verification

- Verdict: APPROVED
- Verifier: dispatched sub-agent (independent)
- Date: 2026-06-03
- Commit: 88ec55a (squash of ca0863e7)
- All 12 ACs confirmed by code inspection with citations
- Test gate: 3282 tests passing (142 test files, exit 0, TypeScript clean)
