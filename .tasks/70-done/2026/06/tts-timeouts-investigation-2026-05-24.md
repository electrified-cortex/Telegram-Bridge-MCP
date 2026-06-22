---
id: tts-timeouts-investigation-2026-05-24
title: "TTS audio synthesis timeouts — investigate + fix"
status: needs-refinement
version: v0.1
target: Telegram-Bridge-MCP
repo: electrified-cortex/Telegram-Bridge-MCP
type: Investigation
priority: 20
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
author: Coordinating agent
source: operator voice msg 60829 (2026-05-24 ~21:27 PT)
dispatch_ready: false
needs_operator: true
blocked_on: "Operator must confirm whether TTS is still timing out at v7.11.1 with scaled timeout. If resolved, close task. If still failing, dispatch investigation."
---

# TTS timeouts — too common; investigate root cause

## Problem

Operator-reported 2026-05-24: TTS synthesis times out frequently. Empirically today, several messages of ~38-46 words hit `tts_timeout: TTS synthesis timed out after 45000ms` with the "Local model not responding" note. Multiple instances per session.

The operator's baseline expectation: recording a two-minute-long audio should work without issue.

Current behavior: 45-second hard timeout. Messages ≥~40 words are at risk; ≥~50 words frequently fail. The audio-chunking memory rule (`feedback_audio_chunking.md`) was a workaround — split into <40-word bursts — but the real fix is a higher / smarter timeout OR a faster TTS path.

## Hypotheses

1. **Local TTS model cold-start / load time.** First call after idle period takes longer than the 45s budget.
2. **Local model performance bottleneck.** The bm_george voice (Kokoro) may be CPU-bound; longer text disproportionately slows.
3. **Timeout value too aggressive.** 45s for a 60-word message may simply be too tight for the local model.
4. **TTS server queue backup.** If multiple sessions request TTS concurrently, queue depth pushes individual requests past the deadline.

## Acceptance criteria

- **AC1:** Operator can send a 2-minute-equivalent audio (~250-300 words) without the bridge timing out.
- **AC2:** Identify the specific source of timeout (cold start, CPU, queue, transport, etc.).
- **AC3:** If timeout is fundamental to the local model's throughput, document a chunking strategy at the bridge level (split long text into multiple TTS calls + concat) rather than asking callers to pre-chunk.
- **AC4:** Telemetry: log p50/p95/p99 TTS synthesis latency per word-count bucket so future regressions are visible.

## Investigation steps

1. Reproduce: send a 100-word, 200-word, 300-word message in a test session. Capture failure rate + actual latency.
2. Inspect TTS server logs for the slow / failed calls — what's the bottleneck (model load, inference, IO)?
3. Compare bm_george (Kokoro) vs other voice options — is the voice the issue?
4. Measure cold-start latency vs warm latency.
5. Decide: bump timeout, chunk-on-bridge, or switch voice/model.

## Notes

- Today's session hit timeouts at 38, 41, 42, 46 words. The 40-word rule is empirical from operator pain, not from spec.
- TMCP returns `tts_timeout` and falls back to text-only delivery. Caller sees the fallback as a text-message-id; the audio is lost.
- Bridge's claude logs format includes `tts_timeout: TTS synthesis timed out after 45000ms (~N words). Local model not responding.` — exact error string for tracing.

## Implementation status (2026-06-20 update)

The flat 45s timeout has been replaced with a **word-count-scaled timeout** in `src/tts.ts` (lines 226-227):
- `TTS_SYNTHESIS_TIMEOUT_PER_100_WORDS_MS` (default 45000 = 45s per 100 words)
- `TTS_SYNTHESIS_TIMEOUT_MIN_MS` (default 45000 minimum)
- Both env vars are now configurable for operators running local models

With 100 words: 45s. With 250 words: ~112s. With 300 words: ~135s.

**Pre-investigation question for operator:** Is TTS still timing out at current settings (v7.11.1)? The scaled timeout may have resolved the original symptom. Operator confirmation needed before dispatching investigation.
