---
title: session/start (and session/create) refresh flag — single-call reconnect
stage: 10-drafts
author: Curator
date: 2026-05-17
delegation: Worker
target_repo: electrified-cortex/Telegram-Bridge-MCP
related:
  - tmcp-onboarding-activity-file-monitor-wiring.md (sibling silent-failure class)
---

# session/start refresh flag

## Problem

Agents currently must branch on token presence at boot:
- No token file -> `action(type: 'session/start', name, color)` (first-boot)
- Token file present -> read token, test with a lightweight call, fall back to `action(type: 'session/reconnect', name)` on `session_closed` / stale error, save new token

This is two distinct call paths with shared cleanup, and every assistant-class pod re-implements the branch. Compaction recovery makes the branch hot: the token survives in the file but the bridge-side session may not. Mistakes here go silent — the agent thinks it's connected but the bridge has already cleaned up the SID, so kicks fire into nothing and the agent never notices until the user pings them directly.

## Goal

Collapse the two paths into one. The agent calls a single action on boot; the bridge does the right thing whether this is a true first-boot, a reconnect of a still-alive session, or a re-establish after the bridge has dropped the SID.

## Requirements

R1. `action(type: 'session/start', name, color, refresh: true)` succeeds in all three states:
  - First boot (no prior session for this `name`): creates a new session, returns a token.
  - Reconnect-of-live (a session for this `name` is still anchored in the bridge): returns the existing token (idempotent — same SID, same token).
  - Re-establish (bridge has no record of this `name`): treats as first boot, returns a fresh token.

R2. The flag is optional; default is `false` (preserves current strict first-boot semantics for callers that depend on first-boot detection).

R3. On every successful return, the response payload is shape-compatible with current `session/start` responses (`token`, `sid`, `hint`, etc.). Callers that already handle the current shape need no changes.

R4. When `refresh: true` returns a reused token (state 2), the response includes a `reused: true` discriminator so callers that DO care can distinguish first-boot from reconnect-of-live.

R5. Response schema for `refresh: true` calls (full shape, formally specified):
```
{
  token: number,             // session token (existing field — same in all states)
  sid: number,               // session ID (existing field)
  reused: boolean,           // NEW field; true for state-2 reuse, false for state-1 or state-3
  hint: string,              // existing optional field — guidance message
  activity_file?: string,    // existing optional — activity-file path if available
  warnings?: string[]        // NEW optional — populated when caller passed `color` alongside a reuse (see B2)
}
```
When `refresh` is omitted or `false`, the response shape is unchanged from current behavior (the `reused` and `warnings` fields are absent).

## Behavior

B1. The bridge looks up an active session by `name` (case-sensitive). If found, returns its token. If not, creates one.

B2. `color` is honored on creation only. On reuse, `color` is ignored (the existing session's color persists). A documented warning in the response payload is acceptable when `color` is passed alongside a reuse.

B3. Activity-file path returned (when present) reflects the current session's path, whether new or reused.

B4. Profile loading (`profile/load`) is the caller's responsibility either way — `refresh: true` does not auto-load a profile.

## Constraints

C1. No change to `session/reconnect` semantics; it remains the explicit re-establish path for callers that want it.

C2. No persistence-format change. The bridge's session-table schema is unaffected.

C3. The flag is additive only. Existing callers that omit it see no behavior change.

## Acceptance criteria (bridge-side)

AC1. `action(type: 'session/start', name, refresh: true)` called against a session that is currently live on the bridge for `name` returns HTTP 200 with `{ token, sid, reused: true, ... }`. The token equals the existing live session's token; SID equals the existing SID. No new session is created.

AC2. `action(type: 'session/start', name, color, refresh: true)` called when no session exists for `name` creates a new session and returns `{ token, sid, reused: false, ... }` (state 1, first boot). Behavior equivalent to omitting `refresh` in this state, except the `reused: false` discriminator is present.

AC3. `action(type: 'session/start', name, color, refresh: true)` called against the same `name` after the bridge has dropped the prior SID (server restart, cleanup, etc.) creates a new session — state 3, re-establish — and returns `{ token, sid, reused: false, ... }`.

AC4. `action(type: 'session/start', name, color)` with `refresh` omitted or `false`: identical behavior to current production — regression test must show byte-equivalent response shape and semantics to a baseline run.

AC5. Name-collision reject path: `action(type: 'session/start', name, refresh: true)` called when a session for `name` exists AND the caller does not present a matching token (see Provisional behavior section) returns a `NAME_IN_USE` error with the documented hint structure. Does NOT silently return the existing token.

AC6. `color` passed alongside a reuse (state 2) is ignored for the session's color but generates a warning in `response.warnings[]`.

## Out of scope

- Renaming session/start to something else.
- Heartbeat / pulse-check semantics — that's a separate skill spec ([[pulse-check-skill]]), though it would call this action.
- Profile-load auto-wiring.

## Open questions

- Should `refresh: true` collapse with `session/reconnect` entirely, or stay as two surfaces? (Draft posits keep both; reconnect is an explicit signal of "I know my prior SID is gone.")

## Provisional behavior — name collision

When `refresh: true` is passed and a session for `name` already exists, the bridge MUST verify caller ownership before returning the existing token. The verification mechanism (specified, not left to worker interpretation):

**Ownership proof = the caller passes a `token` parameter on the `session/start` call AND that token matches the existing live session's token for `name`.** If the call carries no `token`, or the `token` does not match the live session's token, the bridge MUST NOT return the existing token. Instead, return error:

```
{
  error: "NAME_IN_USE",
  message: "A session named '<name>' is already live. Use session/reconnect with the prior token, or pick a different name.",
  sid_in_use: <existing SID>   // informational only — does not leak the token
}
```

Rationale: the bridge has no persistent cross-request caller memory beyond SIDs and tokens. Token-match is the only available proof-of-ownership without adding a new identity surface. A caller that has the token already has the session — refresh is just confirming the session is still live. A caller WITHOUT the token is necessarily a different actor and must not be silently merged into the existing session.

This rejects the two-pods-same-name silent merge that the Architect swarm flagged.

## Overseer review

**Reviewer:** Overseer
**Date:** 2026-05-17
**Verdict:** PASS (re-gate after REVISE round)

**Review type:** adversarial-manual (2 rounds — Haiku R1, inline R2)

**Checked:**
- All 4 REVISE items addressed: target_repo in frontmatter, proof-of-ownership specified as token-match, ACs re-cast bridge-side (AC1-AC6), R5 adds formal response schema
- Name-collision reject path fully specified with error shape and rationale
- AC4 regression test specified (byte-equivalent baseline comparison)
- ACs cover all three session states (first-boot, reconnect-of-live, re-establish after drop)
- Open question on collapse with session/reconnect: consciously deferred (keep both)

**Not checked:** Technical correctness of the TMCP implementation; TypeScript-side test harness wiring.

## Verification

- **Verifier:** Independent sub-agent (task-verification skill)
- **Date:** 2026-05-17
- **Verdict:** APPROVED
- **Squash commit:** 7fb1774 on dev
- **Evidence:** 141 test files, 3124 tests, 0 failures. All 6 ACs confirmed against implementation. Worktree clean at closure.
- **Notes:** `code: "NAME_IN_USE"` used instead of `error:` field — consistent with all other TelegramError shapes in the file (acceptable deviation). `toLowerCase()` in name lookup consistent with pre-existing collision guard (C3 additive, no regression).
