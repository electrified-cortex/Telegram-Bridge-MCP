---
id: "30-0893"
title: "send tool: per-message topic override parameter"
type: feature
priority: 30
created: 2026-05-14
delegation: Worker
target_branch: dev
status: active
claimant: foreman
claimed_at: 2026-05-14T23:33:00Z
worktree: .foreman-pod/.worktrees/30-0893
spawn_task: bszwh78nm
---

# 30-0893 — send tool: per-message topic override parameter

## Context

Topic-state logic already exists in code (`applyTopicToTitle`, `applyTopicToText` in `src/topic-state.js`, used by send/ask + send/notify). It operates on PROFILE-level topic set via `action(type: 'profile/topic', topic: '<text>')` — once set, every outbound message gets the topic header until cleared.

A per-message topic override used to be a `send` parameter (operator memory). It was removed. We want it back.

Use case: Overseer is messaging operator about Telegram MCP work specifically. She can set the per-message topic to "Telegram MCP" so the message renders with the topic header — without permanently changing her profile topic. One-off override, no state pollution.

## Acceptance criteria

1. `mcp__telegram-bridge-mcp__send` schema gains optional `topic` parameter (string).
2. When provided on a `send` call, that string is used as the topic for THIS message only — overrides the profile-level topic if set, doesn't mutate profile state.
3. When omitted, behavior unchanged (profile-level topic applies if set, otherwise no header).
4. Applies to all send modes that already render topic (text, ask, notify, choice). Empty-string clears for that one message.
5. Tool description / help docs surface the parameter so callers know it exists.

## Out of scope

- Profile-level topic set/clear (already works via `action: 'profile/topic'`).
- Topic rendering on non-text modes (file, animation, etc.) — only modes that already use `applyTopicToTitle/Text`.

## Source

- Operator request 2026-05-14T22:20 UTC: per-message topic override; previously existed, removed, want back.
- Code reference: `Telegram MCP/src/topic-state.js` + usage in `src/tools/send/{ask,notify}.ts`.

## Verification

**Verdict:** APPROVED
**Date:** 2026-05-14
**Verifier:** Dispatch sub-agent (fresh-eyes, read-only)
**Cherry-pick commit:** `503d6969` on `dev`

All 5 acceptance criteria CONFIRMED:
- AC1: `topic: z.string().optional()` added to send schema — `send.ts:225-228`
- AC2: Non-mutating override — `applyTopicToTitle/Text` use `overrideTopic` without touching `_topics` Map; threaded to all 6 render paths
- AC3: Undefined falls through to profile-level `_current()` — existing callers unaffected
- AC4: Wired to text, ask, notify, choice, audio+caption modes; empty string → `trim() || null` suppresses header
- AC5: `docs/help/send.md:116-142` "Per-Message Topic Override" section + `describe()` strings in all 4 tool files

155/155 tests pass.
