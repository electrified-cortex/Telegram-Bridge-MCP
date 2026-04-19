---
Created: 2026-04-12
Status: Draft
Host: local
Priority: 10-494
Source: Operator directive (dogfooding critique)
---

# 10-494: Startup hint chain redesign

## Objective

Simplify the post-session-start hint chain. Current flow has a gap and
too many hops. New flow:

1. `session/start` → "Save this token to session memory. Then call help('start')."
2. `help('start')` → load profile if available, then `help('guide')` for reference.

Agent is operational after step 2. Guide is reference, not required reading
before entering the dequeue loop.

## Context

Dogfooding revealed the startup chain funnels agents through:
session/start → help('startup') → help('quick_start') → help('guide').
Three hops, with quick_start as unnecessary intermediary. The guide is 32KB
and shouldn't be a mandatory startup step.

Operator directive: rename `startup` to `start`, collapse `quick_start` into
`start`, frame guide as optional reference.

Subsumes 10-462 — the canon token-save text is part of this redesign.
Uses `session/started` as the help topic name (per operator directive 2026-04-14).

## Changes

### 1. session/start response hint

Exact canon text:

```text
Save this token to session memory. Then call help("start").
```

### 2. Rename help topic: `startup` → `start`

Keep the topic name short and natural.

### 3. Rewrite `start` topic content

New content should:
- Remind agent to load profile if they have one
- Direct to `help('guide')` as optional reference (not required reading)
- **Explicitly state: "Call `dequeue()` with no parameters. Default timeout
  is 5 minutes. This is intentional — blocking reduces token use."**
- For Claude Code sessions: mention `set_dequeue_default` to increase timeout
- Include a mini help-on-help: "For all tools: `help()`. For a specific tool:
  `help('tool_name')`. For the full guide: `help('guide')`."
- All `start` content in ultra compression (audience is agents, not humans)
- NOT reference `quick_start` as a separate hop
- **Every hint must lead to a help call** — this is the design principle

### 4. Fold useful `quick_start` content into `start`

The dequeue loop pattern, send basics, and DM pattern from `quick_start`
should be incorporated into `start` (concisely).

### 5. Remove or redirect `quick_start` topic

Either remove it entirely or make it an alias for `start`.

## Acceptance Criteria

- [ ] `session/start` response uses exact canon hint text
- [ ] `help('start')` exists and returns actionable startup content
- [ ] `help('startup')` is removed or redirects to `start`
- [ ] `help('quick_start')` is removed or redirects to `start`
- [ ] `start` topic mentions profile loading and guide as reference
- [ ] `start` topic includes dequeue loop basics
- [ ] Agent can go from session/start to operational in 2 calls (start + profile/load)
- [ ] Existing tests updated for renamed topic
- [ ] help() overview updated to reference 'start' not 'startup'

## Completion

**Date:** 2026-04-15
**Branch:** `10-494`
**Commit:** `b810a6b`

### What was done

- `session_start.ts`: Updated hint text on both fresh and reconnect paths to exact canon: `"Save this token to session memory. Then call help(\"start\")."`
- `help.ts`: Replaced separate `startup` and `quick_start` handlers with a single handler matching all three names (`start`, `startup`, `quick_start`). Rewrote content in ultra-compressed agent format covering profile load, dequeue default (5 min), dequeue-default override, DM pattern, send basics, guide as optional reference, and mini help-on-help. Removed `startup`/`quick_start` from index/overview, replaced with single `start` entry.
- `help.test.ts` + `session_start.test.ts`: Updated all topic-name and hint-text assertions to match new content.

All 121 tests pass. Typecheck clean.

### Acceptance Criteria

- [x] `session/start` response uses exact canon hint text
- [x] `help('start')` exists and returns actionable startup content
- [x] `help('startup')` redirects to `start` (alias)
- [x] `help('quick_start')` redirects to `start` (alias)
- [x] `start` topic mentions profile loading and guide as reference
- [x] `start` topic includes dequeue loop basics
- [x] Agent can go from session/start to operational in 2 calls
- [x] Existing tests updated for renamed topic
- [x] help() overview updated to reference 'start' not 'startup'
