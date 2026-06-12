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

- [x] Audio sends without an explicit `async` flag are async by default.
- [x] `async: false` per-call still forces sync (returns real `message_id` synchronously).
- [x] `async: true` per-call still works (current 10-803 path).
- [x] Non-audio sends unchanged.
- [x] Changelog entry under "Behavior change" calls out the default flip — existing flows that expected synchronous immediate `message_id` on audio sends must add `async: false` to opt back in.
- [x] help('send') documents the new default and the override.
- [x] Existing 10-803 async path remains the implementation under the hood. No new code paths.

## Constraints

- Don't break existing `async: true` callers — same return shape (`message_id_pending`, `status: queued`, callback) applies.
- Don't change FIFO ordering semantics from 10-803.
- Don't introduce a config setting. The default is the only knob; per-call flag is the override.

## Don'ts

- Don't make non-audio sends async. Sync is correct for short text.
- Don't add a runtime config or env var to flip the default. Operator-rejected.
- Don't surface a hint about "consider async" — the default already does the right thing.

## Completion

Branch: `10-820`
Commit: `a2c895c`
Worker: Worker 4 (SID 13)

**Changes delivered:**
- `src/tools/send.ts`: `args.async === true` → `args.async !== false`; param description updated
- `src/tools/send.test.ts`: all existing sync-path audio tests now use `async: false`; new default-path test asserts `message_id_pending` + `status: queued`
- `docs/help/send.md`: async-default paragraph inserted after hybrid audio+text section
- `changelog/unreleased.md`: behavior-change entry under `### Changed`

**Verification:** 2686 tests pass (0 failures). 3-pass code review (smoke + 2 substantive) signed off. All 7 acceptance criteria confirmed against committed diff.

**Pre-existing issues noted (out of scope):**
- `pendingId` return value from `enqueueAsyncSend` has no range guard (always returns valid number today)
- `docs/help/send.md` hybrid section still omits 1024-char caption limit (pre-existing doc gap)

## Verification

**Verdict:** APPROVED
**Date:** 2026-04-24
**Criteria:** 7/7 passed
**Evidence:** `send.ts` line 311 flipped from `args.async === true` to `args.async !== false` inside the `if (audio)` guard; `send.test.ts` updated all existing sync-path audio tests to use `async: false`, replaced the "async omitted → sync" test with a "async omitted → async by default" test asserting `message_id_pending` + `status: queued`; `docs/help/send.md` line 104 documents the new default and `async: false` override; `changelog/unreleased.md` entry under `### Changed` states the behavior flip and migration note; diff is exactly 4 files with no new code paths introduced.
