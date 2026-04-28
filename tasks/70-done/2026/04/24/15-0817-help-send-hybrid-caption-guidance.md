---
id: 15-0817
title: help('send') hybrid caption guidance — swap TL;DR for pointer semantic
status: draft
priority: 15
origin: operator voice 2026-04-24 msg 42007 — observed Curator twice writing captions that duplicate the audio body
---

# help('send') hybrid caption guidance — swap TL;DR for pointer semantic

## Problem

`help('send')` Audio+Text section currently says:

> Pattern: voice = full detail, caption = TL;DR.

"TL;DR" reads to agents as "shorter version of the same content." That IS the anti-pattern this guidance is meant to prevent. Agents composing a hybrid message consult `help('send')` at send time; it's the authoritative-feeling prescription. When it disagrees with best practice (captured in agent memory as "caption = topic pointer, not summary of audio"), agents regress to whatever the tool doc says.

Observed twice in one session: Curator produced voice+caption where caption restated the audio. Operator flagged it as a tool-level defect, not an agent discipline gap. Correct call — discipline memories only patch one agent; the doc fix reaches every agent reading help.

## Proposed

Rewrite the hybrid paragraph in the `text` section of `help('send')` to replace "TL;DR" with explicit pointer semantic plus a concrete do/don't example.

Target text (current):

```
**Audio + Text (`"text"` type):** `send(type: "text", text: "...", audio: "...")` → voice note + text caption in one msg.
Use for urgent updates where operator may be away from phone.
Pattern: voice = full detail, caption = TL;DR.
```

Target text (proposed):

```
**Audio + Text (`"text"` type):** `send(type: "text", text: "...", audio: "...")` → voice note + text caption in one msg.
Caption is a topic pointer, not a summary of the audio. The audio carries the full content; the caption frames what the voice is about, names a file/command/identifier the operator may want to copy, or flags urgency. Never restate the audio in writing — the operator will read one and skip the other, and duplicated content wastes tokens on both sides.

Good: audio = "Diagnosis. TMCP help send hybrid guidance is underspecified…" | caption = "TMCP bug located. See help('send') hybrid section."
Bad:  audio = "TMCP's help send guidance is underspecified…"               | caption = "TMCP's help send guidance is underspecified."
```

Also consider (lower priority): parameter-level reminder when both `text` and `audio` are supplied — description for `text` could note "When `audio` is also provided, this is a caption (topic pointer, not a summary)."

## Requirements

- Replace the "TL;DR" phrasing in the Audio+Text paragraph of `help('send')`.
- Include explicit do/don't example showing non-overlapping content.
- Keep the rest of the Audio+Text section intact (use-case, button caveat, interactive-mode alternatives).

## Acceptance

- [ ] `help('send')` output contains "topic pointer" (or equivalent) and does NOT contain "TL;DR".
- [ ] Output includes a concrete good/bad example pair.
- [ ] No behavior change in the send tool itself — doc-only.

## Don'ts

- Don't add a new `type` or parameter for hybrid. The existing `type: "text"` with both `audio` and `text` is the right shape.
- Don't bury the guidance deeper — this is exactly the section agents consult at send time.
- Don't delete the "Use for urgent updates" use-case — it's correct.

## Related

Curator memory (already correct, predates this doc drift): `feedback_hybrid_messaging_spectrum`, `feedback_hybrid_message_caption`, `feedback_operator_prefers_audio`.

## Completion

- File already had "TL;DR" removed and "topic label" in place from a prior pass.
- Added concrete Good:/Bad: example pair after the Hard rule line in `docs/help/send.md`.
- All acceptance criteria met: no "TL;DR", "topic label" present, good/bad example included.
- Commit: `1418fd1` on branch `15-0817` in `.worktrees/15-0817`.
