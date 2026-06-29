# Backlog: TMCP Full Table Rendering in Multi-Chunk / Effect / Audio Sends

**Priority:** LOW (operator 2026-06-29)
**Backlogged from:** PR #258 BK-2 (Case A + Case B deferred)

## Context

Telegram's 4096-char/message limit means an oversized table cannot be one message in any mode — rich-text/HTML included. This is a platform constraint, not a TMCP bug.

Current state after PR #258 + fail-loud guard task: any send path that hits a table but cannot render it returns `TABLE_NOT_RENDERED` error. Callers are aware the table was not rendered.

## What this task would do

**Case A** — single-chunk table excluded only by `effect` or `inflightAudio`:
- Carry effect into GFM rich path (effect does not prevent rendering)
- Sequence audio-queued sends so the rich table send follows the audio

**Case B** — multi-chunk content with an embedded table:
- Isolate the table block as its own single-message GFM rich send
- Chunk surrounding prose separately
- Must respect 4096-char platform limit per message

## Notes

- Both cases require careful sequencing/splitting logic
- Must stay within pnpm/harness-agnostic/no-Python constraints
- W-1 (TOCTOU race on table auto-upgrade) may be relevant to Case A
- File under proper TMCP task format when prioritized

## Operator-proposed approach (2026-06-29) — table-as-attachment ("magical fix")

- Prior art to verify: operator notes Mermaid chart rendering already placeholders the chart and delivers it as an attachment. Apply the same pattern to tables (confirm the Mermaid mechanism when implementing).
  - DEPENDENCY (2026-06-29): operator reports the Mermaid feature itself is NOT yet ideal and wants to refine it first. This pattern is therefore gated on Mermaid refinement. See `.tasks/00-ideas/mermaid-refinement-2026-06-29.md`.
- Core idea: when a table can't render inline (oversized / multi-chunk / effect / audio path), extract it, leave an inline placeholder, and deliver the table as a **markdown file attachment**.
- Preemptive signal: detect the un-renderable condition BEFORE sending so the caller can reformulate or opt into the attachment path — not only fail after the attempt.
- Residual edge case: after extracting the table to an attachment, the remaining inline content may STILL exceed the 4096-char limit. Detect this — if removing the table does not make the rest fit, it stays a fail-loud case.
- Net: attachment-extraction likely resolves most oversized-table cases; the residual (rest-still-too-big-after-extraction) remains fail-loud. Candidate Case B solution when prioritized.
