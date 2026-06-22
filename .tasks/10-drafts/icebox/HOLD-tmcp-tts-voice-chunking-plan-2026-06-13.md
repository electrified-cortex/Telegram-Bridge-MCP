# Task: TMCP — TTS Long-Input Client-Side Chunking (Plan Phase)

**ID**: tmcp-tts-voice-chunking-plan
**Date**: 2026-06-13
**Priority**: High
**Status**: Draft
**Origin**: Curator directive (pod inbox 2026-06-13)

## Background

TMCP's TTS pipeline synthesizes voice via voice.cortex.lan (Kokoro CPU). Long inputs fail
silently because synthesis time exceeds nginx's 120s timeout. The current split strategy
uses `splitMessage(audioText)` at line 361 of `src/async-send-queue.ts`, which splits at
4096 characters (~600-700 words) — far too large for single-shot Kokoro synthesis.

`synthesizeToOgg` in `src/tts.ts` enforces `TTS_LIMIT = 4096` chars as the hard gate,
throwing if exceeded. The character limit is correct but the synthesis time per chunk is
the real constraint. A 4096-char chunk can take several minutes; ~100 words takes <10s.

Credentials and voice.cortex.lan changes are deferred. Fix must work within current
architecture (CPU Kokoro, existing voice.cortex.lan).

## Objective

**PLAN ONLY — no code changes in this task.**

Analyze the voice send path in TMCP and produce a written implementation plan for
client-side TTS chunking. Post the plan to the agent outbox; the Curator will
checkpoint before any implementation proceeds.

## Relevant Files (read-only)

- `src/async-send-queue.ts` line 361: `const voiceChunks = splitMessage(audioText);`
  - This is the primary fix point — change to a TTS-safe splitter here
- `src/tts.ts` lines 74-75: `TTS_LIMIT = 4096` and lines 316-317: throws if exceeded
- `src/telegram.ts` line 493: `splitMessage` function — reference for splitting approach
- `src/tts.test.ts`, `src/async-send-queue.test.ts`: understand test coverage

## Scope

### In scope

1. **Code analysis** — read the four files listed above; understand the full voice send path
   from job dispatch through `synthesizeToOgg` and `sendVoiceDirect`
2. **Plan document** covering:
   - Exact insertion point (file, function, line where `splitForTts` is called)
   - Algorithm for `splitForTts(text, maxWords)`:
     - Split at sentence boundaries (`.`, `!`, `?`, clause breaks) within word limit
     - Maximum 100 words per chunk (strict upper bound, not approximate)
     - Hard fallback: split at nearest word boundary if no sentence boundary exists within 100 words
   - Threshold: chunking activates when input exceeds 100 words; inputs of 100 words or fewer are sent as a single shot with no splitting
   - Non-regression guarantee: short messages must pass through unchanged (no extra
     API calls, no behavioral change below threshold)
   - Send sequence: each chunk sent as a sequential `sendVoiceDirect` call — already
     handled by existing `for` loop at line 363 in `async-send-queue.ts`
   - Test impact: which existing tests need updating; what new tests cover chunking
   - Estimated change size (files touched, approximate lines added)
3. **Post plan** to agent outbox with subject line `tmcp-tts-chunking-plan`

### Not in scope

- Any code changes
- voice.cortex.lan, nginx, or infrastructure changes
- Credential or API-access changes
- GPU/remote TTS
- Implementation — this task ends when the plan is posted

## Acceptance Criteria

| # | Criterion | Pass condition |
|---|-----------|----------------|
| AC1 | Plan posted | Foreman posts to `messages/outbox/post.sh` with subject `tmcp-tts-chunking-plan`; message contains all plan sections |
| AC2 | Insertion point named | Plan names exact file, function name, and approximate line where `splitMessage` call is replaced |
| AC3 | Algorithm described | Plan describes sentence-boundary split method, 100-word maximum per chunk (strict), and hard word-boundary fallback when no sentence boundary found |
| AC4 | Threshold defined | Plan explicitly states: inputs >100 words activate chunking; inputs <=100 words are single-shot unchanged |
| AC5 | Non-regression explained | Plan states what happens to a 50-word message (single synthesis call, no split, behavior unchanged) |
| AC6 | Test impact named | Plan names the affected test files and describes at minimum 2 new test cases to be added |
| AC7 | No code committed | `git status` on TMCP repo shows no new or modified files from this task |

## Delegation

**Repo**: `electrified-cortex/Telegram-Bridge-MCP`
**Foreman**: existing TMCP foreman (81dcc473) — queue after V8 Rich-Messages tasks
**Language**: TypeScript (analysis only — no changes)
**Note**: Foreman reads code, writes plan, posts to outbox. Agent forwards to Curator.
Curator checkpoints before implementation task is created.

## Agent review

**Reviewer**: Agent
**Date**: 2026-06-13
**Verdict**: PASS
**Review type**: Adversarial dispatch (gate fail v1 — 4 blockers fixed: AC3 tilde ambiguity, AC4 threshold unspecified, AC6 vague "assessed", AC3 missing fallback clause)
**Checked**: Binary ACs, bounded scope (plan-only, AC7 no-code gate), delegation, code references verified against src/tts.ts:74-75 and src/async-send-queue.ts:361, outbox mechanism explicit, threshold concrete (>100 words), fallback algorithm present
**Origin**: Curator directive (pod inbox 2026-06-13) — Curator-authorized work
