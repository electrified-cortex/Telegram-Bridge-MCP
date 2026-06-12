---
id: 05-0826
title: recording-indicator refcount race + typing-suppression gaps (post-Copilot review)
priority: 5
status: done
type: bug-fix
delegation: any
---

# recording-indicator refcount race + typing-suppression gaps

Findings from a Copilot CLI / GPT-5.3-Codex review of commit `2473daa5` ("feat: implement recording indicator management for async voice sends; suppress typing emission during audio jobs"). All four findings reviewed and judged legitimate; the critical one is a real concurrency bug.

## Critical — refcount state corruption after safety timeout

`src/async-send-queue.ts`, `acquireRecordingIndicator` / `releaseRecordingIndicator`:

The 120s safety handler deletes the chat entry unconditionally. `releaseRecordingIndicator(chatId)` has no generation/token check.

**Race:**

1. Job A acquires → state = `{count: 1, ...}`.
2. 120s safety fires → state cleared.
3. Job B acquires fresh state → `{count: 1, ...}` (Job B's).
4. Job A's `finally` runs `releaseRecordingIndicator(chatId)` → decrements / clears Job B's state.

Result: `record_voice` indicator stops while Job B is still running, typing resumes prematurely. Worse on busy chats.

**Fix:** epoch / generation token attached to the entry at acquire-time, passed back to release. `releaseRecordingIndicator(chatId, epoch)` is a no-op if the current entry's epoch differs (or entry is missing).

## Concern — typing suppression too broad

`src/typing-state.ts`, `_suppressedChats`:

Suppression blocks the interval emission for *all* `showTyping` actions (not just `"typing"`). During an async audio job, an agent calling `showTyping("upload_photo")` would also be suppressed. That's broader than the intent.

**Fix:** suppression set should be keyed by action type, OR check the action type before suppressing. Document the intent — if blocking everything is intended, say so; if only typing is intended, narrow it.

## Concern — typing suppression incomplete (initial sendChatAction)

`showTyping`: suppression is checked only inside the interval tick, not before the initial immediate `sendChatAction`. A fresh `showTyping("typing")` while suppression is active still fires one typing action before getting suppressed on subsequent ticks.

**Fix:** check suppression at the top of `showTyping` before the immediate `sendChatAction` call.

## Concern — `resumeTypingEmission` hardcodes `"typing"`

`src/typing-state.ts`, `resumeTypingEmission`: reasserts `"typing"` literal, even if the previously-active action for that session/chat was `"record_voice"` or an upload action that got suppressed.

**Fix:** track the suppressed action's original `action` value per chat, restore that on resume. If no prior action, restore nothing.

## Concern — sync voice path: release before delay/cancel

`src/tools/send.ts`: `releaseRecordingIndicator(chatId)` is called before the 3s post-send delay and before `cancelTypingIfSameGeneration(gen)`. Combined with the suppression-incomplete issue above, this can briefly emit `"typing"` during the intended post-voice window.

**Fix:** reorder — delay + cancel first, then release. Or: release inside a finally block that runs after the delay.

## Acceptance criteria

- New test reproducing the safety-timeout + late-release + new-acquire race; old code fails it, new code passes.
- New test asserting non-typing actions are NOT suppressed during audio jobs (or are, with explicit intent documented).
- New test asserting `showTyping` does not fire even one immediate `sendChatAction` when suppression is active.
- New test asserting resume restores the prior action, not a hardcoded "typing".
- New test for sync voice path order: post-send delay completes BEFORE `releaseRecordingIndicator`.
- All five tests pass; existing async-send-queue tests still pass.

## Source of findings

Copilot CLI v1.0.18 + `--model gpt-5.3-codex` + `--allow-all-tools -p -s`. Diff piped via stdin. Review prompt asked for Critical / Concerns / Nits sections, no praise. Took ~2 min, returned the above plus 2 nits about adding tests for the race and suppression-scope behavior (both already in acceptance criteria above).

This is the first real-world test of Copilot CLI as a headless reviewer for this workspace. Findings track with what a careful manual reviewer would surface — no hallucinations, no nonsense.

## Related

- `agents/curator/notes/copilot-cli-headless-mode-update-2026-04-25.md` — verification of Copilot CLI on this Windows box.
- Source commit: `2473daa5` on branch `dev`.
- Branch: also present on `release/7.2`. If fixes land on `dev`, port to `release/7.2` per `docs/release-branching-process.md`.

## Completion

Completed 2026-04-26 by Worker 1. Branch `05-0826`, commit `679d28f`.

All 5 acceptance criteria satisfied: 2848 tests pass including new tests for the race scenario, suppression coverage, initial sendChatAction suppression, resume priorAction/fallback paths, and sync voice ordering.

**Changes in `src/async-send-queue.ts`:** `acquireRecordingIndicator` returns epoch token; `releaseRecordingIndicator(chatId, epoch)` is a no-op on epoch mismatch; safety-timeout closure on re-acquire path captures epoch to prevent stale-closure clobbering; `cancelSessionJobs` comment added for intentional guard bypass.

**Changes in `src/typing-state.ts`:** `showTyping` checks suppression before initial `sendChatAction`; `pauseTypingEmission` records active action per chat; `resumeTypingEmission` restores recorded action (not hardcoded "typing"); `showTyping` extension path updates `s.action`; total-suppression intent documented.

**Changes in `src/tools/send.ts`:** Post-send delay guarded by `voiceStarted` (first chunk delivered) not `voiceSent` (all chunks); `releaseRecordingIndicator` deferred until after delay + cancel; dead `voiceSent` variable removed.

Note: dev push hold in effect — branch ready for review but cannot merge to dev until hold lifted.
