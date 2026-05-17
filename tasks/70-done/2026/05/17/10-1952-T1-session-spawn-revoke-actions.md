---
id: 10-1952-T1
title: TMCP — add session/spawn-child, session/revoke-child, child/forward, and child_capability enforcement
type: task
delegation: Worker-claimable (Overseer dispatches)
stage: queued
parent: 10-1952
prd_version: v0.2
created: 2026-05-16
target_branch: main
---

# TMCP — Add sub-session Phase 1 actions

## Context

PRD 10-1952 v0.2 (Sub-sessions) Phase 1. **This task was updated 2026-05-16 to reflect v0.2 additions** — if a worker claimed an earlier version of this task, read this file in full before continuing; scope changed significantly.

Phase 1 adds three new actions to TMCP's action registry, two new fields to the `Session` record, and capability-check middleware. No changes to: message routing for replies, `TimelineEvent` schema, inbound polling path, or Telegram Forum topic handling.

Phase 1 routing isolation uses the existing `_messageOwnership` map and `topic-state.ts` label prefix. No Forum topic support in this task.

## What to build

### Session record changes

Add to the `Session` record:
- `parent_sid?: number` — set when created via `session/spawn-child`; null for root sessions
- `child_capability: 'read-only' | 'gather' | 'full'` — default `gather` for children; root sessions get `full`

### Capability middleware

Add capability-check middleware on action dispatch. A session with `child_capability: 'gather'` MUST be denied on:
- `session/start`
- `session/spawn-child`
- Any commit-class action

Return `CAPABILITY_DENIED` on denial. Child with `child_capability: 'full'` has no restrictions. `read-only` permits dequeue only (no send/react).

### `session/spawn-child`

**Input:** `token` (parent token, authenticated), `name` (string), `color` (emoji, optional), `child_capability?: 'read-only'|'gather'|'full'` (default: `gather`)

**Auth check:** TMCP MUST verify the supplied `token` belongs to the authenticated caller's session. Return `UNAUTHORIZED` if mismatch.

**Behavior:**
- Creates a new TMCP session. Stores `parent_sid = <parent session's sid>` and `child_capability` on the new session record.
- Sets child session's topic label to `[<name>]` via `topic-state.ts`.
- Fires the operator-tap ticket flow (same as `session/start`). The parent's token does NOT bypass operator approval in Phase 1.

**Output:** `{ token: <number>, sid: <number>, parent_sid: <number>, expires_at?: <iso> }`

### `session/revoke-child`

**Input:** `token` (parent token), `child_token` (child to revoke)

**Auth check:** Verify the child session's `parent_sid` equals the calling parent's sid. Return `UNAUTHORIZED` if not the parent.

**Behavior:**
- Closes the child session via existing `session/close` logic. Drains the child's queue.
- After revoke: any call using `child_token` returns `SESSION_NOT_FOUND`.

**Output:** `{ closed: true, sid: <number> }`

### `child/forward`

New action: allows a parent to inject a message into a child session's dequeue queue.

**Input:** `token` (parent token), `child_sid` (target child session ID), `message` (string text to inject)

**Auth check:** Verify `child_sid` session has `parent_sid` equal to the caller's sid. Return `UNAUTHORIZED` otherwise.

**Behavior:**
- Injects `message` into `child_sid`'s inbound queue as if it came from the operator. This is the governor-forwarding path: when the operator sends a non-reply message during an active child session, TMCP delivers it to the parent's queue first; the parent then calls `child/forward` to route it to the appropriate child.

**Output:** `{ forwarded: true, child_sid: <number> }`

## Acceptance criteria

- **AC1.** `action(type: 'session/spawn-child', token: <parent>, name: 'Helper', color: '🟪')` returns `{ token: <child>, sid: <new-sid>, parent_sid: <parent-sid>, expires_at?: <iso> }`. Child token is usable on session-tool paths allowed by `child_capability`. Verified by integration test.
- **AC1b.** TMCP rejects `session/spawn-child` when the supplied parent token does not match the authenticated caller's session — returns `UNAUTHORIZED`. Verified by integration test with non-matching token.
- **AC1d.** A child with `child_capability: 'gather'` calling `session/spawn-child` returns `CAPABILITY_DENIED`. Verified by integration test.
- **AC2.** After `session/revoke-child`, calling any tool with the child token returns `SESSION_NOT_FOUND`. Verified by integration test.
- **AC3.** Child sends message → operator sees `[Helper] <text>` in shared chat. Operator replies to that message → reply lands in child's dequeue only (not parent's). Verified by manual E2E test.
- **AC3b.** Operator sends non-reply message during active child session → TMCP delivers to parent's queue (not child's). Parent calls `child/forward` → message appears in child's dequeue. Verified by E2E test.
- **AC3c.** `child/forward` with a non-parent caller returns `UNAUTHORIZED`. Verified by integration test.
- **AC8-P1.** `session/spawn-child` triggers the standard operator-tap approval flow. Verified by manual demo step.

## Out of scope

- Parent-delegated approval bypass (`parent_delegated: true`) — Phase 2.
- Forum topic binding — Phase 2 (10-1952-T3-phase2).
- `TimelineEvent` schema changes.
- Inbound polling path changes.

## Notes

- `spawn-child` wraps the existing session-creation path. Key additions: populate `parent_sid` and `child_capability` on the Session record; return the richer response shape; add the auth check before creating.
- `revoke-child` wraps existing `session/close`. Add parent-ownership check first.
- `child/forward` is new queue injection — conceptually: write to the child session's `TemporalQueue` as if it were an operator message. Check the queue API to find the appropriate inject method.
- The capability middleware can be a pre-dispatch interceptor that reads the session's `child_capability` and compares against an allowlist per action path.

## Verification

- **Verdict:** APPROVED
- **Date:** 2026-05-17
- **Verifier:** task-verification dispatch (sonnet)
- **Commit:** e7ad746e (squash of wt/1952-T1 → dev)
- **ACs confirmed:** AC1, AC1b, AC1d, AC2, AC3, AC3b, AC3c, AC8-P1 (all 7 criteria)
- **Tests:** 3116 passing (141 files)
- **Notes:** AC3 — `setTopic(name)` called in child session context; outbound-proxy suppresses name_tag when topic set, producing `[Helper] <text>` format as specified.

## Overseer review

- **Reviewer:** Overseer
- **Date:** 2026-05-16
- **Verdict:** APPROVED (v0.2 update)
- **Review type:** adversarial-manual (updated to match PRD v0.2 swarm-review revisions)
- **Checked:** ACs binary/testable, scope matches NFR1 (3 actions + Session fields + capability middleware), delegation correct (Worker), all 4 new v0.2 items covered (FR1b capability, AC1b auth, FR3b child/forward, AC3b/3c governor routing), no blocking OQs for Phase 1
- **Not checked:** TMCP internal file structure (module paths, queue inject API) — Worker inspects source
