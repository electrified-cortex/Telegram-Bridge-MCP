---
title: Migrate sub-session-dispatch skill from EC plugin to TMCP
stage: 10-drafts
author: Overseer
date: 2026-05-17
delegation: Worker
target_repo: electrified-cortex/Telegram-Bridge-MCP
priority: P1
related:
  - electrified-cortex/skills/sub-session-dispatch/SKILL.md (source to remove)
  - TMCP v8 plugin (destination vehicle)
---

# sub-session-dispatch skill — migrate to TMCP

## Problem

`sub-session-dispatch` is currently a skill in the `electrified-cortex/skills` repo (and shipped in the EC plugin). It is TMCP-specific — it describes how to use `session/spawn-child`, `child/forward`, and `session/revoke-child`. Operator direction (2026-05-17): this skill belongs in TMCP, not in the EC general plugin. It will be shipped as part of a TMCP v8 plugin.

## Scope

1. **Copy** `electrified-cortex/skills/sub-session-dispatch/SKILL.md` into `Telegram-Bridge-MCP/skills/sub-session-dispatch/SKILL.md` (create `skills/` directory if it doesn't exist).
2. **Update** the skill content if anything is outdated relative to the Phase 1 implementation (session/spawn-child, child/forward, session/revoke-child — all live on dev).
3. **Commit** to dev in TMCP.
4. **File a removal task** back to EC skills repo to strip `sub-session-dispatch` from `electrified-cortex/skills/` on the next publish cycle (do NOT delete it yet — EC plugin is still in use; removal is a separate PR).

## Out of scope

- TMCP v8 plugin scaffolding (separate task)
- EC plugin republish with sub-session-dispatch removed (follow-on)

## Acceptance criteria

1. `Telegram-Bridge-MCP/skills/sub-session-dispatch/SKILL.md` exists and accurately describes the Phase 1 sub-session actions.
2. Content is verified against current `session/spawn-child`, `child/forward`, `session/revoke-child` tool schemas.
3. Committed to TMCP dev branch.

## Overseer review

Reviewer: Overseer
Date: 2026-05-17
Verdict: PASS
Review type: light-scan
Checked: scope clear, target_repo correct, delegation complete, ACs binary
Not checked: technical correctness of skill content (worker verifies against live schema)

## Verification

Verifier: Dispatch sub-agent (sonnet)
Date: 2026-05-18
Verdict: APPROVED

AC1 PASS — `skills/sub-session-dispatch/SKILL.md` exists (207 lines), covers spawn-child, child/forward, revoke-child with input schemas, process steps, failure modes, report schema, and worked example.
AC2 PASS — Cross-checked against live implementations: spawn-child (spawn-child.ts lines 11-54, SPAWN_CHILD_SCHEMA lines 56-81), child/forward (forward-child.ts lines 7-10, action.ts line 669), revoke-child (revoke-child.ts lines 9-11, REVOKE_CHILD_SCHEMA lines 44-54). Three corrections applied vs EC source (spawn-child return fields token/sid, numeric token in example, revoke-child child_token is SID integer).
AC3 PASS — Committed on worker branch, squash-merged to dev as e4f24b8.

Sealed-By: Foreman (claude-sonnet-4-6)
