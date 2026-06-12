---
id: "10-533"
title: "Hybrid message auto-split on caption overflow"
status: draft
priority: 30
created: 2026-04-13
tags: [tmcp, send, hybrid, caption]
source: Operator (voice)
---

# Hybrid Message Auto-Split on Caption Overflow

## Objective

When a hybrid `send()` call (both `audio` and `text`) exceeds Telegram's
1024-character caption limit, automatically split into two messages instead
of truncating. Improves information delivery without data loss.

## Context

Currently when `audio` + `text` are both provided and the text exceeds
1024 chars, the caption is silently truncated. The operator loses content.

Operator directive: "produce the audio message first, and then a text as a
separate message. Let the agent know it was split."

## Proposed Behavior

1. Detect caption would exceed 1024 chars.
2. Send audio message first (no caption, or short caption like "⬇️ details below").
3. Send text as a separate follow-up message.
4. Return response indicating the split:
   - `message_id` of the audio message
   - `text_message_id` of the follow-up text
   - `split: true` flag
   - `_hint` explaining: "Caption exceeded limit; audio sent as msg {id}, text sent separately as msg {text_id}."

## Acceptance Criteria

- [x] Hybrid messages exceeding 1024 chars auto-split into audio + text
- [x] Audio message sent first, text follows
- [x] Response includes both message IDs and `split: true`
- [x] `_hint` explains the split and why
- [x] Messages under 1024 chars continue working as single hybrid messages
- [x] Build passes

## Completion

- **Branch:** `10-533`
- **Commit:** `e8362dc`
- **Worktree:** `Telegram MCP/.worktrees/10-533`
- **Completed:** 2026-04-15

Replaced caption truncation with auto-split: voice sent without caption, text sent as follow-up `sendMessage`. Response: `{ message_id, text_message_id, split: true, audio: true, _hint }`. Under-limit path unchanged. Build passes, 2221 tests pass (109 files).
