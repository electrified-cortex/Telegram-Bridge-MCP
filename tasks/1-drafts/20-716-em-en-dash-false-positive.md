# 20-716 - Remove em-dash and en-dash from unrenderable-chars blocklist

## Context

Operator (2026-04-19): em-dash and en-dash render fine in Telegram on the operator's clients. The `10-590` unrenderable-chars work added them to the blocklist anyway, so every message containing `—` or `–` triggers an `unrenderable_chars_warning` service message — false positive, agent-facing noise.

Confirmed live: Curator's reply containing `—` triggered the warning while operator was actively reading and seeing the dash render correctly.

## Acceptance Criteria

1. **Remove `—` (U+2014, em-dash) and `–` (U+2013, en-dash)** from `UNRENDERABLE_CHARS` in `src/unrenderable-chars.ts`.
2. **Update tests** in `src/unrenderable-chars.test.ts` — the cases asserting em/en dash flag must invert (or be deleted).
3. **Audit the rest of the list while in there.** Anything else on the blocklist that the operator's clients render fine? Curly quotes (`"` `"`) and ellipsis (`…`) are the obvious next candidates — verify before removing.
4. **Keep arrows, box-drawing, block elements.** Those are the original target — don't touch.
5. **Verify against a real send** before merging — send a message with `—`, `–`, and an arrow; confirm only the arrow trips the warning.

## Constraints

- Don't disable the warning system; just trim the false positives.
- The export contract (`UNRENDERABLE_RANGES`, `UNRENDERABLE_CHARS`, `findUnrenderableChars`) stays the same.

## Open Questions

- Are curly quotes ever broken on any Telegram client? If unsure, leave them flagged and only remove em/en dash in this task.

## Note on the original rationale (operator 2026-04-19)

Em/en dashes were probably flagged because they cause real problems when LLM output gets pasted into bash/PowerShell scripts (parser confusion, copy-paste hazards). That context IS legitimate — but it's a script-safety concern, not a Telegram-rendering concern. The `unrenderable_chars_warning` event_type promises the latter; conflating the two produces false positives in the channel that uses it.

If we want to keep an LLM-output script-safety check, it belongs in a different signal (different event_type, possibly opt-in per-target) — not this one. Out of scope for this task; just don't lose the rationale when trimming.

## Delegation

Worker (TMCP). Curator stages, operator merges. Trivial scope — single-file edit + test fix.

## Priority

20 - quality. Active false-positive nuisance during normal operator-facing messaging.

## Related

- `10-590-unrenderable-character-warning` (the original task that overshot).
- Memory `feedback_avoid_arrow_chars.md` (still valid for arrows; the rule was always about arrows, not dashes).
