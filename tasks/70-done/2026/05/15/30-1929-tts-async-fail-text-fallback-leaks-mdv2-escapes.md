---
id: "30-1929"
title: "TTS async-fail text fallback leaks MarkdownV2 escape sequences"
type: bug
priority: 30
created: 2026-05-15
delegation: Worker
target_branch: dev
---

# 30-1929 — TTS async-fail text fallback leaks MarkdownV2 escapes

## Context

When a `send` call with both `audio` (TTS) and `text` (caption) is made async (default for audio sends), and the TTS server fails to synthesize within the timeout, TMCP falls back to posting the text portion as a normal text message. That fallback path correctly fires (`textFallback: true`, `textMessageId` returned), but the text it posts is the **MarkdownV2-escaped** version of the caption — backslashes everywhere, intended for V2 rendering alongside a voice note that no longer exists.

## Reproduction

`send(audio: "<long string>", text: "Got it. Order: (1) ... watch.ps1 + retest...", parse_mode: "Markdown")` with TTS server timing out. The text that lands in chat is:

```
⚠ [async failed] Got it\. Order: \(1\) spec \+\= debounce \(default 2s, max 60s\), \(2\) implement in `watch.ps1` \+ retest \+ re\-audit, \(3\) write `watch.sh` \(route to pwsh if available, else 2s sleep\+poll\), \(4\) test on bash\. Working\.
```

Note `\.` `\(` `\)` `\+` `\=` `\-` — V2 escape sequences exposed as literal backslashes in the rendered output.

Witnessed 2026-05-15. Operator: "the escape sequences are retained" (msg 55461 reply to 55459).

## Acceptance criteria

1. When the async-fail text fallback fires, the posted text matches what would have been posted by a `text:`-only send with the same `parse_mode` (default `Markdown`, auto-converted to V2 with proper escaping THAT GETS RENDERED, not displayed literally).
2. The `[async failed]` ⚠ banner stays (or moves to a service line) — operator wants the visibility, but it should not corrupt the body.
3. Existing audio-success path (caption alongside voice note) remains unchanged.
4. Test: send with `audio: "..."` + `text: "Step (1) and step (2)."`, force TTS timeout, verify chat shows `Step (1) and step (2).` not `Step \(1\) and step \(2\)\.`

## Out of scope

- Fixing the underlying TTS timeout (separate concern).
- Changing the `[async failed]` banner format.
- Sender-side: agents shouldn't have to pre-escape — TMCP owns parse_mode conversion.

## Source

- Operator catch 2026-05-15 — msg 55461 reply to 55459 (the escaped fallback). Triggered by my own send while reporting on the file-watching skill ship.

## Completion

Added `rawCaptionText` field to `AsyncSendJob`. When TTS fails async, `executeJob` now calls `markdownToV2(rawCaptionText)` fresh and sends with `parse_mode: "MarkdownV2"`. Banner `⚠ [async failed]` properly V2-escaped. Existing audio-success path unchanged. New test validates MdV2 fallback path. Commit `c7dcc5da` on branch `30-1929`.

## Verification

APPROVED — 2026-05-15. All 4 criteria confirmed: fresh MdV2 conversion on fallback, banner preserved and properly escaped, audio-success path unchanged, test validates correct rendering. Cherry-picked as `d6ca1314` onto `dev`.

Sealed-By: foreman
