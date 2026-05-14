---
id: "10-0867"
title: "Fix text-after-audio message ordering — text must queue behind in-flight audio"
type: bug
priority: 30
status: completed
created: 2026-05-04
repo: Telegram MCP
delegation: Worker
depends_on: []
target_branch: release/7.5
claimant: foreman
claimed_at: 2026-05-14T23:14:00Z
worktree: .foreman-pod/.worktrees/10-0867
spawn_task: bjlbse1in
completed_at: 2026-05-14T23:31:00Z
worker_commit: e15b25cb
---

> **REJECTED — 2026-05-14 — Foreman (task-verification sub-agent)**
>
> All 3 acceptance criteria UNMET. The worker's deliverables (`enqueueTextSend`, `hasInflightAudio`,
> `send.ts` guard, 7 new tests) exist only in dangling commits `85e7f79d` and `3cd66a2b` that are
> unreachable from any branch. PR #168 squash commit `ab1d4139` does NOT include these changes.
> The bug remains **unfixed in production**. Task has been returned to drafts for re-dispatch.
> Prior completion history is preserved below for reference.

# Fix text-after-audio message ordering

## Observed (2026-05-04)

Operator caught: when an outbound audio message is in-flight (TTS rendering), a subsequent text message dispatched by the agent arrives at the operator's chat BEFORE the audio. The text "races past" the audio because TTS rendering is slower than text delivery.

**Concrete sequence (from this session):**

1. Curator (SID 1) sends hybrid (audio + text caption) at T=0.
2. Audio enters TTS render pipeline; text caption attached.
3. Curator dispatches a text-only follow-up at T+5s.
4. Operator receives the text-only at T+6s.
5. Audio (with original caption) arrives at T+12s — out of order from agent's intent.

Result: operator gets follow-up context before the original message lands. Confusing on the operator side; broke conversation flow during the skill-auditing remediation thread.

## Root cause (suspected)

TMCP's outbound dispatch doesn't sequence text-after-audio. Audio goes through the TTS render queue (slow); text bypasses it (fast). No back-pressure on text from agent A's session if a prior audio from agent A is still rendering.

## Fix

Per-session outbound queue ordering. When an agent has an audio message in TTS rendering, subsequent text messages from the same agent MUST queue behind it for delivery — not race ahead.

Possible implementations:

1. **Per-session FIFO outbound queue** — all outbound messages (text, audio, hybrid) flow through a single queue per session SID. Audio renders, text waits its turn.
2. **Audio-pending lock** — when audio is mid-TTS, set a session-level lock that blocks subsequent text dispatches until audio resolves. Releases on TTS-complete or timeout.

## Acceptance criteria

- Test: agent dispatches audio at T=0, then text at T+5s. Operator receives audio at T+12s, then text at T+13s.
- No agent-side blocking — the dispatch returns immediately; the queue handles ordering. Agent doesn't see the wait.
- Cross-agent ordering NOT enforced (different SIDs race normally — only within-session ordering matters).

## Out of scope

- Text-only-after-text-only ordering (already fine).
- Cross-agent ordering across different SIDs (separate concern).

## Dispatch

Worker. Sonnet for the queue design + integration; Haiku for the test fixtures.

## Bailout

3 hours. If TMCP architecture lacks a per-session outbound queue, surface to Curator before designing one.

## Notes

- Friction surfaced 2026-05-04 during skill-auditing remediation; operator explicitly flagged it as a bug ("if it was being sent over audio, this message should have queued behind it. That's a bug.").
- Memory entry: `feedback_telegram_session_lifecycle.md` may need updating after fix lands.

## Completion

- Branch: `10-0867`
- Commit: `85e7f79d`
- Worktree: `.worktrees/10-0867` (dangling — not reachable from any branch)
- Approach: Per-session text queuing via `tailPromise` chain in `async-send-queue.ts`. `enqueueTextSend` chains text sends behind in-flight audio when `hasInflightAudio(sid)` is true. Text dispatch returns `message_id_pending` immediately (non-blocking); send_callback delivered on completion or failure. Two-argument `.then()` pattern ensures chain resilience if sendMessage throws.
- Tests: 7 new tests (FIFO ordering, queued delivery, cancellation, chain resilience on failure, send.ts gating). All 2986 tests pass.
- Code review: 2 passes — Major finding (chain-breaking single-arg `.then()`) found and fixed in second iteration. Final verdict: SAFE TO MERGE.

## Completion

**Sealed:** 2026-05-07
**Shipped:** PR #168 — TMCP v7.4.1 (squash-merged to master `ab1d4139`)
**Squash commit:** `3cd66a2b` (on release/7.4)
**Verdict:** APPROVED
**Sealed by:** Overseer (Worker dispatch)

## Verification (Re-dispatch — 2026-05-14)

**Verdict:** APPROVED
**Date:** 2026-05-14
**Verifier:** Dispatch sub-agent (fresh-eyes, read-only)
**Cherry-pick commit:** `539da4c5` on `release/7.5`

All 3 acceptance criteria CONFIRMED:
- AC1: FIFO ordering enforced — text queues behind in-flight audio. `async-send-queue.test.ts:813-843` confirms audio-delivered before text-delivered.
- AC2: Non-blocking — `send.ts:464-493` returns `message_id_pending` immediately via `enqueueTextSend`; agent does not wait.
- AC3: Per-session isolation — queue state keyed by SID (`_sessions Map`); cross-session races unaffected. `async-send-queue.test.ts:794-808`.

3026/3026 tests pass. Implementation: `hasInflightAudio(sid)` + `enqueueTextSend(sid, fn)` in `async-send-queue.ts`; gating guard in `send.ts`. 15 new tests across both test files.

Prior REJECTED verdict was due to dangling commits in the original attempt (PR #168 squash missed the implementation). This re-dispatch is reachable from branch `10-0867`.
