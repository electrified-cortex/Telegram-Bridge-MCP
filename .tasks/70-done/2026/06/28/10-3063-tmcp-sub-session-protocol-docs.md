---
created: 2026-06-27
status: draft
priority: 10
source: Operator voice TG 80374, 80380, 80382, 80393; split from 10-3062
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
severity: high
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
blockedBy: ~10-3057 (DONE 2026-06-28, commit e40d1ea0)
---

# TMCP — Sub-Session Protocol Documentation

**ID**: 10-3063
**Date**: 2026-06-27
**Priority**: High
**Origin**: Operator TG 80374, 80380, 80382, 80393 (split from 10-3062)

## Context

Sub-sessions work mechanically but agents have no reliable path to knowing:
1. What "subsession / child session / thread" means and how to act on it
2. What the host agent must do immediately after spawning a child
3. What the child agent receives and what it should expect

These gaps are documentation/onboarding gaps — the bridge code itself does not need to change for this task.

## Gap A — Vocabulary → action mapping (bootstrap approach)

**Operator decision (TG 80393):** Bridge-side keyword detection is iceboxed. The chosen approach: agents learn at bootstrap. The governor should receive a curated nudge listing recommended help topics on first connect — one of which is sub-sessions/threads.

**What to implement:**
- The `SPAWN_CHILD_SUBAGENT_HINT` service message text already reaches the **parent** agent after spawn. Enhance this text to explicitly instruct the parent to call `session/forward-child` with a task brief immediately.
- Governor startup service message (scope TBD, keep minimal): inject a `behavior_hint_help_topics` or similar service event that lists `['sub-sessions', ...]` as slugs the agent can call `help(slug)` on. **Design note**: Keep scope minimal per operator ("I don't want to go too far"). Recommend starting with just sub-sessions + any other topics with known onboarding gaps. Do not build a general topic registry — one targeted nudge is enough.

**NOT in scope for this task:** Bridge-side keyword detection on inbound operator messages (iceboxed).

## Gap B — Child agent context on arrival

`SPAWN_CHILD_SUBAGENT_HINT` tells the parent to launch a background sub-agent with the child token, but does not tell the parent to forward task context to the child.

**What to implement:**
- Update `SPAWN_CHILD_SUBAGENT_HINT` text in `src/service-messages.ts` to add an explicit required step: call `session/forward-child` with a task brief before the child's first dequeue. Make this a MUST, not a suggestion.
- Update `AGENTS.md` Sub-sessions section (see below) to document this as required host protocol.

## Gap C — Host agent post-spawn protocol undocumented

There is no explicit documentation for what the spawning host agent must do after `session/spawn-child` returns:
- Forward task brief via `session/forward-child` (must, immediate)
- Monitor for `CHILD_SESSION_RESOLVED` in its dequeue and handle `exit_status`
- Revoke child with `session/revoke-child` if child goes silent (timeout at host's discretion)

**What to implement:**
- `AGENTS.md`: add a "Sub-sessions" section covering all of the above
- `LOOP-PROMPT.md`: add sub-session initiation and host duty steps explicitly

## Files to modify

| File | Change |
|------|--------|
| `src/service-messages.ts` | Enhance `SPAWN_CHILD_SUBAGENT_HINT` text to require `forward-child` task brief step |
| `AGENTS.md` | Add "Sub-sessions" section: vocabulary (subsession/thread/child session → spawn-child), host protocol sequence, child arrival orientation |
| `LOOP-PROMPT.md` | Add sub-session initiation steps + host duties |
| `src/service-messages.ts` (or new file) | Add bootstrap help-topic nudge service message constant (scoped to governor, minimal) |

> **Pre-dispatch prerequisite**: Identify where `SPAWN_CHILD_SUBAGENT_HINT` is currently defined. Confirm `LOOP-PROMPT.md` exists and find its path before dispatching to Worker.

## Acceptance Criteria

- [ ] **AC1**: `grep -c "session/forward-child" AGENTS.md` returns > 0
- [ ] **AC2**: `grep -c "spawn-child\|SPAWN_CHILD" AGENTS.md` returns > 0
- [ ] **AC3**: `grep -c "CHILD_SESSION_RESOLVED" AGENTS.md` returns > 0
- [ ] **AC4**: `grep -c "revoke-child\|session/revoke" AGENTS.md` returns > 0
- [ ] **AC5**: `SPAWN_CHILD_SUBAGENT_HINT` text in `src/service-messages.ts` contains the word "forward" (or "forward-child") directing the parent to inject a task brief
- [ ] **AC6**: `LOOP-PROMPT.md` contains "spawn-child" (or "sub-session" / "subsession") and describes host duties
- [ ] **AC7**: Bootstrap help-topic nudge service message constant exists in `src/service-messages.ts` (or dedicated file) — `grep -c "help_topics\|HELP_TOPICS\|bootstrap.*help\|help.*bootstrap" src/service-messages.ts` returns > 0 (adjust slug to match implementation)

## Dependencies

- **10-3057 DONE** (2026-06-28, commit e40d1ea0): blocker resolved — child SSE isolation implemented, child sessions confirmed showing topic chip
- **Does NOT block 10-3064** (governor hard-block) — that is independent

## Delegation

Needs Overseer gate → Worker

## Verification

**Status**: APPROVED  
**Verifier**: aac1ef4e465959082  
**Date**: 2026-06-28  
**Squash commit**: e437469  

All 7 ACs confirmed:
- AC1: `session/forward-child` appears ×2 in AGENTS.md ✓
- AC2: `spawn-child` / `SPAWN_CHILD` appears ×4 in AGENTS.md ✓
- AC3: `CHILD_SESSION_RESOLVED` appears ×1 in AGENTS.md ✓
- AC4: `revoke-child` / `session/revoke` appears ×2 in AGENTS.md ✓
- AC5: `SPAWN_CHILD_SUBAGENT_HINT` contains "forward" / "forward-child" directing parent ✓
- AC6: `LOOP-PROMPT.md` contains `spawn-child` + host duties (forward-child REQUIRED, revoke-child on silence) ✓
- AC7: `ONBOARDING_HELP_TOPICS` constant in `src/service-messages.ts` with `behavior_hint_help_topics` ✓
