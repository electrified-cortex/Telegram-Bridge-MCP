---
id: 10-820
title: Audio sends async by default
status: queued
priority: 10
origin: operator voice 2026-04-24
---

# 10-820 — Audio sends async by default

## Problem

Today, `send(... audio: ...)` is synchronous by default. Async is opt-in via `async: true`. Long TTS hits 504 silently or blocks the agent's turn for 60+ seconds. Operators see silent drops and blocking gaps; agents waste turn-time.

## Desired behavior

- For any `send()` call that includes an `audio` param, the default behavior is async (per the 10-803 contract: returns `message_id_pending` + `status: queued`, callback follows).
- Caller can force sync with `async: false` per call.
- Caller can also explicitly pass `async: true` (no behavior change — already the new default).
- For non-audio sends (text-only, file, notification, etc.), no change. Sync remains.

No new config value. No runtime toggle. The default just flips for audio-bearing sends.

## Acceptance criteria

- [ ] Audio sends without an explicit `async` flag are async by default.
- [ ] `async: false` per-call still forces sync (returns real `message_id` synchronously).
- [ ] `async: true` per-call still works (current 10-803 path).
- [ ] Non-audio sends unchanged.
- [ ] Changelog entry under "Behavior change" calls out the default flip — existing flows that expected synchronous immediate `message_id` on audio sends must add `async: false` to opt back in.
- [ ] help('send') documents the new default and the override.
- [ ] Existing 10-803 async path remains the implementation under the hood. No new code paths.

## Constraints

- Don't break existing `async: true` callers — same return shape (`message_id_pending`, `status: queued`, callback) applies.
- Don't change FIFO ordering semantics from 10-803.
- Don't introduce a config setting. The default is the only knob; per-call flag is the override.

## Don'ts

- Don't make non-audio sends async. Sync is correct for short text.
- Don't add a runtime config or env var to flip the default. Operator-rejected.
- Don't surface a hint about "consider async" — the default already does the right thing.
