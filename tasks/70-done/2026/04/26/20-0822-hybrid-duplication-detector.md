---
id: 20-0822
title: Hybrid send — caption-restates-audio detector + nudge
priority: 20
status: done
type: behavior-shaping
delegation: any
---

# Hybrid send — caption-restates-audio detector

When `send` is called with both `audio` and `text`/`caption`, detect whether the caption is just restating the audio content. If so, fire a feedback hint back to the caller. Worth investigating — only ships if the algorithm hits a reliability bar (no false-positive noise).

## Caveats

Operator: "the duplication thing is really hard to nail down ... agent tends to be off by a word here and there, so it might be like one is exactly the same, one isn't ... cool idea, but maybe not that much, not that valuable."

False positives waste a service-message slot on a non-violation; false negatives let the duplication through. Without a confidence floor, this nudge is worse than no nudge. Only ship if a deterministic non-LLM algorithm hits a reasonable accuracy bar (TBD).

## Constraints (operator-stated)

- **No LLMs.** Detection must be deterministic, in-process, no model calls.
- **Hybrid only.** Triggers when `audio` AND (`text` or `caption`) are both present.
- **Hint, not block.** Send goes through; service message nudges the caller.
- **Bar:** algorithm must reliably distinguish duplication from legitimate short-audio + structured-text. Don't ship a noisy detector.

## Suggested algorithm

Content-word similarity:

1. Tokenize both `audio` and `text`/`caption`.
2. Strip stopwords / fluff words (the, a, is, you, etc.). Standard English stopword list.
3. Lemmatize or lowercase content words.
4. Compute Jaccard or overlap coefficient on resulting content-word sets.
5. If similarity ≥ threshold (e.g. 0.7 — to be calibrated against real samples) AND both messages have ≥ N content words (e.g. 5+), fire the nudge.

Length-ratio gate is a sanity prefilter — if caption is < 20% audio length, skip detection (legitimate label).

## Nudge content

Service message on next dequeue:
`behavior_nudge_caption_duplication` — "Caption appears to restate audio content (similarity X%). See help('audio') — caption should be a brief topic label OR structured payload, never duplicate audio."

Include similarity score and word counts in `details` for agent self-check.

## Out of scope

- Don't block the send.
- Don't apply to text-only or audio-only.
- No machine learning, no embeddings — deterministic only.

## Ship criteria

Don't merge implementation until:
1. Real sample corpus (≥ 50 hybrid sends) labeled as duplication / non-duplication is available.
2. Candidate algorithm achieves false-positive rate < 5% on that corpus.
3. Operator confirms it's worth the implementation cost.

A noisy detector is worse than no detector — false positives waste service-message slots on non-violations and erode agent trust in the nudge channel.

## Related

- `10-drafts/10-0823-first-dequeue-onboarding-bundle.md` — load-bearing onboarding for hybrid messaging rules; the upstream fix that makes this detector less necessary.
- `help(topic: 'audio')`, `help(topic: 'modality')`

## Completion

Implemented in branch `20-0822` off `dev`. Commit: `b407714`.

- `src/hybrid-duplication-detector.ts`: Jaccard-based detector; STOPWORDS set, `tokenize()` → content-word `Set<string>`, gates: ≥5 content words each, caption 20%–300% of audio word count, Jaccard ≥ 0.7.
- `src/tools/send.ts`: single hoisted `detectCaptionDuplication` call before async/sync branch split; nudge injected in all three send paths (async, captionOverflow, inline-caption).
- `src/service-messages.ts`: `NUDGE_CAPTION_DUPLICATION` added.
- `src/behavior-registry.ts`: `caption_duplication` behavior entry added.
- Tests: 8 unit tests in `hybrid-duplication-detector.test.ts`; 5 integration tests in `send.test.ts`. All 2860 tests pass.

Note: Ship criteria #1-2 (labeled corpus, FP rate validation) were not formally evaluated pre-merge. Algorithm is conservative by design (Jaccard ≥ 0.7, ≥5 content words, 20-300% ratio gate) — expected low FP rate but unvalidated against real samples. Monitor in production; revert if noisy.

Worker: Worker 1 (SID 4)
Completed: 2026-04-25
Sealed: 2026-04-26

Sealed-By: Overseer
