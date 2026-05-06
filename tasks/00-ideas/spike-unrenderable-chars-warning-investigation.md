# Spike: investigate `unrenderable_chars_warning` validity

**Source:** operator 2026-05-05, msg 50010, replying to msg 50009 ("ASCII arrows correction"): "Why do we actually ban Unicode arrows? They work great. Maybe there's a certain condition that they don't work in, maybe they don't work in captions or something, but we need a spike to figure out why Unicode arrows are bad, because they look great and they work fine."

## Problem

TMCP emits `unrenderable_chars_warning` service messages when outbound text contains certain Unicode characters (e.g. `→` U+2192, `↔` U+2194). Operator reports these characters render fine in Telegram. Curator self-policed them as banned — likely an over-correction based on warning frequency.

## Spike goals

1. Identify the actual emission site of `unrenderable_chars_warning` in TMCP source. What characters are flagged? What logic decides "unrenderable"?
2. Test cases: send each of `→ ↔ ⇒ ⇄ ↗ ↩ ⟶ ⟷` etc. in:
   - Plain text message
   - Voice caption
   - Inline keyboard button label
   - Animation frames
   - Notification body
3. Identify which surfaces (if any) actually render broken on operator's primary Telegram client (mobile + desktop).
4. Recommendation:
   - Tighten the warning to only fire on actually-broken surfaces, OR
   - Remove the warning entirely if no breakage exists, OR
   - Keep warning + add a "renders fine — just informational" caveat in service message text.

## Out of scope

- Box-drawing characters (`├ ─ └`) — separate concern, presumably do break button labels.
- ASCII-only mode for low-bandwidth clients — separate UX choice, not addressed here.

## Bailout

- 60 min cap.
- If the spike requires sending many test messages and burns operator's chat, sample 3-5 cases per surface, then report.

## Output

`tasks/00-ideas/unrenderable-chars-spike-findings.md` with:
- Source-of-warning code path identified
- Per-surface render test results
- Recommended action (tighten / remove / annotate)

## Related

- Memory `feedback_telegram_ascii_arrows_strict.md` — rule rescinded 2026-05-05; tracks the correction.
