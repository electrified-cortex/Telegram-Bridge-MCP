# 20 - Deprecate the unrenderable-chars warning (disable by default; arrows are fine)

## Decision (operator 2026-06-08, voice 69553/69557)

Arrows (`->`, U+2192 etc.) render fine in Telegram. The `unrenderable_chars_warning`
fires on nearly every structured message and is a false positive. Operator's chosen
approach: **DEPRECATE / disable the warning — do NOT tear it out.**

> "I kind of just want to pull out that warning... it's that simple. Then we can
> deprecate the warning in such a way that it's like, hey, this is unhooked — but
> if the bug really comes back, then maybe we need to rethink it, instead of
> completely tearing it out. Maybe it's enabled/disabled by default or something."

So: keep the detection code and event mechanism intact, but **unhook it by default**.
Re-enabling must be a one-line flip, not a rebuild.

## Root cause (operator's recollection — capture, don't lose)

The warning was an over-reaction at some point where an arrow "wasn't rendering
right" — likely under **strange/partial conditions** (e.g. a message split / partial
cutoff making a glyph *look* broken mid-stream), NOT the glyph itself failing. That
means the real defect (if any) was a streaming/split artifact, not an unrenderable
character — which is why a blanket char blocklist was the wrong tool.

## Approach (recommended -> minimal)

**Recommended — default-off flag (true deprecation):**

1. Gate `warnUnrenderableChars` (src/tools/send.ts:66; call sites L408/L430/L525)
   behind a config flag (e.g. `UNRENDERABLE_WARNING_ENABLED`) that **defaults to
   false**. When off, the scan/emit is skipped entirely (no perf cost, no event).
2. Leave `findUnrenderableChars` / `UNRENDERABLE_CHARS` / `UNRENDERABLE_RANGES` and
   `src/unrenderable-chars.ts` fully intact — the mechanism stays, just unhooked.
3. Mark the warning **@deprecated** in code comments + help/docs, with a one-line
   "flip the flag to re-enable if a genuine render bug reappears."
4. Tests: keep `unrenderable-chars.test.ts` unit tests (the detector still works);
   add/adjust a test asserting the warning is **not emitted** when the flag is off
   (default), and IS emitted when forced on.

**Minimal fallback (if a flag is overkill):** comment-out / early-return the three
`warnUnrenderableChars` call sites in send.ts, leaving a clear `// deprecated — see
task` note. Same net effect (unhooked, recoverable) with less surface.

## Acceptance criteria

- [ ] Default behavior: a send containing `->` (and any other glyph) emits NO
      `unrenderable_chars_warning`.
- [ ] The detection code (`unrenderable-chars.ts` + exports) remains present and
      unit-tested — NOT deleted.
- [ ] Re-enabling is a single, documented flip (flag true, or un-comment call sites).
- [ ] `@deprecated` noted in code + help/docs.
- [ ] Live verify: a Curator send with arrows comes back with no warning event.

## Delegation / gates

- Worker/Overseer implements; Curator stages context; **operator commits/merges**.
- Small, well-bounded. Don't gold-plate the flag mechanism.

## Related

- `tasks/70-done/2026/04/19/20-716-em-en-dash-false-positive.md` (prior trim — removed em/en dash, kept arrows; superseded by this broader deprecation)
- `tasks/10-drafts/10-0580-tmcp-unrenderable-char-audit.md` (broader char audit)
- `tasks/70-done/2026/04/18/10-590-unrenderable-character-warning.md` (the original feature now being deprecated)
- Superseded scratch: `tasks/.scratch/unicode-arrow-false-positive.md`

## Priority

20 - quality. Active false-positive nuisance on nearly every structured message.
