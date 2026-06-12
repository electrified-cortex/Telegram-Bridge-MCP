---
id: "50-0866"
title: "TTS render timeout for hybrid sends (prevent silent indefinite block)"
type: task
priority: 50
status: queued
created: 2026-05-04
repo: Telegram MCP
delegation: Worker
depends_on: []
---

# TTS render timeout for hybrid sends

## Background

From 2026-05-03 Overseer wedge postmortem.

Last tool call before Overseer wedged: a hybrid `text+audio` send card
at 18:37:05. Theory (un-proven, pattern-matched): the TTS render
hung server-side, the client-side request never returned, and the
agent's tool-call site was waiting indefinitely.

If TTS rendering hangs, the entire send blocks the agent. This is
indistinguishable from a healthy long-running send and provides no
escalation path.

## Goal

TTS-bearing sends (audio-only or hybrid text+audio) MUST complete
within a hard timeout. On timeout:

- Server returns a structured error to the client.
- Client receives it as a normal tool error (not a hang).
- Agent can recover, retry text-only, or surface the failure.

## Procedure

1. **Research the timeout cause first** (operator-directed, msg 50768).
   Before adding a timeout wrapper, distinguish:
   - **Server-side timeout** — TTS provider / model times out and
     returns an error. Errors bubble; we just need to surface them.
   - **Client-side hang** — request never returns; no error, no
     response. This is what we're trying to catch.

   These are different failure modes with different fixes. Inspect
   the wedge postmortem (`agents/curator/memory/projects/2026-05-03-overseer-wedge-postmortem.md`)
   and any relevant TTS render logs / network traces. If it's
   server-side erroring already, we may need very little; if it's
   genuine client hang, the timeout is the right fix.

2. Find the TTS render path in the bridge (likely in `tts/` or
   wherever audio-rendering lives).

3. Wrap the render call in a timeout (only if step 1 confirms client
   hang as a real failure mode).

   **Default: 60 seconds minimum** (operator-directed, msg 50761 —
   cancelling too early on legitimate long renders is the bigger risk).

   **Scale dynamically by word count** (operator-directed, msg 50766).
   Proposed formula: `timeout_seconds = max(60, words / 100 * 60)` —
   ~60s per 100 words of audio content. Liberal. Examples:
   - 50 words → 60s (floor)
   - 100 words → 60s (floor)
   - 200 words → 120s
   - 500 words → 300s

   Configurable per-100-word factor. Don't go below 60.

4. On timeout: return a `tts_timeout` structured error response.

5. Update `send` tool docs (and `help('send')`) to document the new
   error case + recovery pattern.

## Acceptance criteria

- Hybrid sends with deliberately-broken TTS render path return
  structured error within timeout (not a hang).
- Timeout is configurable.
- Error is documented + caller-actionable.
- Existing healthy TTS flows unchanged (no regression).

## Out of scope

- Async TTS rendering (separate concern; this task is purely
  timeout + error path).
- Bridge auto-terminate (separate task: 50-0865).

## Dispatch

Worker. Sonnet for the timeout wrapping; Haiku for the test add.

## Bailout

Hard cap 2 hours. 15-min progress heartbeats. If TTS uses an
external provider with its own timeout semantics that conflict,
surface — don't double-timeout.

## Related

- `agents/curator/memory/projects/2026-05-03-overseer-wedge-postmortem.md`
- 50-0865 (auto-terminate) — sibling task.

## Completion

**Branch:** `feat/50-0866-tts-render-timeout`
**Commits:**
- `44603a18` — add dynamic timeout to TTS HTTP synthesis
- `2f033fbb` — guard NaN in env var parsing, extract wordCountForTimeout helper

**Implementation:**
- Added `wordCountForTimeout()` and `computeTtsSynthesisTimeoutMs()` helpers to `src/tts.ts`
- Added `AbortSignal.timeout(timeoutMs)` to `synthesizeHttpToOgg()` fetch call
- Dynamic timeout formula: `max(60s, ceil(words/100) * 60s)` — configurable via `TTS_SYNTHESIS_TIMEOUT_PER_100_WORDS_MS` and `TTS_SYNTHESIS_TIMEOUT_MIN_MS`
- AbortError caught and re-thrown as `{ code: "tts_timeout", timeoutMs, wordCount }`
- NaN env var guard: `|| 60000` fallback if parseInt returns NaN
- 2 new tests in `src/tts.test.ts` — 73/73 passing

**Status:** In 60-review. Awaiting Curator verification pass.

- Rev2 commit \833c751c\: TimeoutError catch fix + AbortError test + send.md tts_timeout docs. 74/74 tests pass.