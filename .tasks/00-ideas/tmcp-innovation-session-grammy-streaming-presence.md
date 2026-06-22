---
title: TMCP innovation session — grammY features, streaming, presence
source: operator (TG 77728), queued 2026-06-22
priority: medium
status: idea
type: research + innovation
---

## Scope

This is a research AND innovation session — not just investigation, but design/proposal output.

## Research questions

1. **grammY new features** — what has changed in the grammY library (grammy.dev) since TMCP was last synced? Any new plugins, middleware, reaction APIs, story support, etc.?

2. **TMCP feature gap analysis** — what Telegram capabilities/bot features have been added that TMCP doesn't yet expose? Examples: thread support, topics, forum groups, polls, reactions (native), business mode, etc.

3. **Streaming text from Claude Code** — by what means can Claude Code output be streamed to Telegram in real time? Options to evaluate:
   - `stream/start` + `stream/chunk` + `stream/flush` (already in TMCP)
   - `append` pattern (already in TMCP)
   - Server-Sent Events relay from CC stdout
   - Direct Telegram `editMessageText` loop
   - Any new grammY streaming helpers?

4. **Better feedback/presence** — what improvements can be made to the presence/progress experience?
   - More granular animations / frames
   - Native Telegram "typing..." indicator duration extension
   - Progress bars with richer labels
   - Reaction-based acknowledgment patterns
   - Real-time status updates during long agent tasks

## Deliverable

- Research summary (what grammY has that TMCP doesn't use)
- Feature proposals with implementation sketches (not full specs — enough to discuss)
- Prioritized shortlist of what to build next

## Notes

Operator called this an "innovation session" — expect to have an async design discussion after research returns, not just a dump of findings.
