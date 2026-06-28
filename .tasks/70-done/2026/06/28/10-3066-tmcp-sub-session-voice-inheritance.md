---
created: 2026-06-27
status: draft
priority: 10
source: Operator voice TG 80450, 2026-06-27
repo: electrified-cortex/Telegram-Bridge-MCP
type: Defect / UX
severity: medium
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# TMCP — Child Sessions Should Inherit Parent Voice Profile

**ID**: 10-3066
**Date**: 2026-06-27
**Priority**: Medium
**Origin**: Operator TG 80450

## Problem

When `session/spawn-child` creates a child session, it correctly inherits the parent's `name` and `color` — the child presents to the operator as the same participant. However, the TTS **voice** profile is not inherited. The child starts with a default (or no) voice, which is jarring: the operator hears a different voice from what they expect.

Operator verbatim (TG 80450): "I would expect that sub-sessions or child sessions inherit your voice, or inherit whatever the profile's voice is, not just the name tag, but the voice as well... It's a little bit off-putting that it's not your voice, even though I know that you're a sub-session."

## Current Behavior

`session/spawn-child` (in `src/tools/session/`) inherits:
- `name` ✓
- `color` ✓
- `voice` ✗ — not inherited; child starts with no/default TTS voice

## Expected Behavior

Child sessions inherit the parent's full voice profile at spawn time:
- `voice` (TTS voice name)
- `voice_speed` (TTS speed multiplier)

This matches the existing logic for name/color inheritance. If the parent has no voice configured, the child likewise starts with none.

## Implementation

Locate the child session creation path in `src/tools/session/` (likely `spawn-child.ts` or similar). Where `name` and `color` are copied from the parent session, also copy `voice` and `voice_speed` from the parent's profile.

Pre-dispatch: verify the exact field names for voice in the session profile object (check `profile/voice` action implementation or session profile schema).

## Acceptance Criteria

- [ ] **AC1**: A child session spawned from a parent with voice configured starts with the same voice — verified by calling `profile/voice` on the child token and observing the inherited voice name
- [ ] **AC2**: `grep -c "voice" src/tools/session/spawn-child.ts` (or equivalent file) returns > 0 in the inheritance block
- [ ] **AC3**: A child spawned from a parent with NO voice configured also has no voice (null/default) — inheritance is conditional on parent having voice set
- [ ] **AC4**: Unit test: spawning a child from a parent with voice "nova" → child session voice is "nova"

## Dependencies

None. Independent of 10-3057, 10-3063, 10-3064, 10-3065.

## Delegation

Needs Overseer gate → Worker

## Verification

**Status**: APPROVED  
**Verifier**: a50f99c4e5d8d62ae  
**Date**: 2026-06-28  
**Squash commit**: 21029fe  

All 4 ACs confirmed:
- AC1: Child inherits parent voice at spawn (spawn-child.ts:112-121, test:492-497) ✓
- AC2: `grep -c "voice" spawn-child.ts` = 3 in inheritance block ✓
- AC3: No-voice parent → no-voice child (`if (parentVoice !== null)` guard) ✓
- AC4: Unit test — parent voice "nova" → child voice "nova" ✓

Test gate: 4016/4016 pass.
