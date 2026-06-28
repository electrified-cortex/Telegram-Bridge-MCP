---
created: 2026-06-28
status: draft
priority: 10
source: Operator TG 80601, 2026-06-28
repo: electrified-cortex/Telegram-Bridge-MCP
type: Defect / UX
severity: medium
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
---

# TMCP — Audio Messages from Sub-Sessions Missing Topic Label

**ID**: 10-3068
**Date**: 2026-06-28
**Priority**: Medium
**Origin**: Operator TG 80601

## Problem

When a child sub-session sends a **voice/audio (TTS) message**, the topic label is absent. For text messages from sub-sessions, the topic appears in the name tag or caption so the operator knows which sub-session is speaking. For audio messages, this label is not applied — the operator cannot tell which sub-session generated the audio.

Operator verbatim (TG 80601): "audio messages from sub-sessions don't have the topic added."

## Current Behavior

- Text messages from child sub-sessions: topic label visible (name tag prefix or caption)
- TTS/audio messages from child sub-sessions: no topic label — audio arrives without any sub-session context

## Expected Behavior

Audio messages from child sub-sessions should include the topic in the Telegram voice message caption, the same way text messages carry the name tag prefix. Operator must be able to identify which sub-session sent any given audio clip.

## Investigation Needed

- Find where TTS messages are dispatched in the send path (likely `src/tts.ts` or `src/send.ts`)
- Determine how text messages apply the nametag/topic prefix — find the equivalent hook for audio message captions
- Check whether TTS sends use Telegram `caption` field on `sendVoice`; if so, topic should be prepended to that caption
- If no caption is currently sent with voice messages, add one with the session nametag + topic

## Acceptance Criteria

- [ ] **AC1**: A TTS/audio message sent by a child sub-session includes the topic in the Telegram voice message caption
- [ ] **AC2**: The caption format is consistent with text message nametag format (e.g., `🟦 Curator — Local LLMs`)
- [ ] **AC3**: Audio messages from the parent (non-child) session are unaffected — nametag format unchanged or improved
- [ ] **AC4**: `grep -c "caption" src/tts.ts` (or equivalent) returns > 0 in the sub-session dispatch path after fix

## Dependencies

Related to 10-3063 (sub-session protocol docs) and 10-3066 (voice inheritance) — independent, can dispatch separately.

Also related to 50-0093 (sub-session UX bugs, Bug #1: session announcement) and `rich-message-nametag-missing-2026-06-27.md` (00-ideas) — different root cause but same operator pain point.

## Delegation

Needs Overseer gate → Worker

## Verification

**Status**: APPROVED  
**Verifier**: a9ea952663b8f740e  
**Date**: 2026-06-28  
**Squash commit**: 21029fe  

All 4 ACs confirmed:
- AC1: TTS job wrapped in `runInSessionContext(job.sid)` → `buildHeader` gets correct sid → caption injected (async-send-queue.ts:134-137) ✓
- AC2: Same `buildHeader`/`resolveNameTag` path as text messages → identical format ✓
- AC3: `buildHeader` returns empty when `primarySessionCount() < 2` → parent single-session unaffected ✓
- AC4: 15 `caption` occurrences in `async-send-queue.ts` (equivalent path, tts.ts is synthesis-only) ✓

Test gate: 4016/4016 pass.
