---
id: 05-0830
title: send type:choice — chosen highlights briefly with others defaulted, then auto-collapse
priority: 5
status: draft
type: feature
delegation: any
---

# choice callback UX — brief selection feedback, then collapse

When `send(type: "choice")` receives a callback, the bridge currently re-renders the keyboard with all buttons styled `primary` (output of `buildHighlightedRows`). Operator: that's lame. The chosen button should look chosen; the unchosen buttons should fade. Then the keyboard should roll up into the final message a moment later.

## Current behavior (post 05-0825)

- `send(type: "question")` — answer collapses keyboard immediately, message text updated. **Operator: feels great. Don't touch.**
- `send(type: "choice")` non-blocking — callback fires; bridge calls `buildHighlightedRows` which restyles all buttons to `primary`; keyboard persists tappable. **Operator: lame.** Multi-tap control-panel use case is still valid (separate concern), but for one-shot use the persistence is wrong.

## Desired behavior (one-shot choice)

Two-stage animation:

1. **Selection feedback (immediate, ≤ network round-trip):** chosen button takes the primary style (or success/danger if originally styled that way); ALL other buttons go to default Telegram style (no color, plain background). This is visually distinct from the current "all primary" state.
2. **Collapse (≈500 ms after step 1):** keyboard removed entirely; message text gets the standard selection suffix (current "▸ <label>" behavior). Same end state as a `question` answer.

Operator quote: "I would want the keyboard to be updated on that message with an immediate but what looks like an immediate button selection... and then no more than a second later, maybe even a half a second later, go ahead and roll it up."

## Multi-tap control panel — preserve

The existing intentional divergence (per 05-0825 final notes in `choice.ts`) where non-blocking choice keeps the keyboard for repeat presses MUST still be reachable. Two design options for caller surface — pick one and document:

**Option A (recommended):** Default `send(type: "choice")` to one-shot collapse. Add explicit `persistent: true` (or similar) flag to opt into the multi-tap control-panel mode. Most callers want one-shot.

**Option B:** Keep current default. Add `oneShot: true` flag to opt into the new collapse animation. Backwards-compatible but pushes UX cost onto every caller.

Operator preference not yet stated — bring back to operator before implementing if you pick a different option than A.

## Acceptance criteria

- After a callback on a one-shot `send(type: "choice")`:
  - Within ~500 ms (single edit cycle): chosen button rendered in its original style or upgraded to `primary`/`success`; all OTHER buttons rendered with no style (default).
  - Within ~1 s total: keyboard cleared; message text shows the selection suffix; no buttons remain tappable.
- `send(type: "question")` behavior unchanged (still immediate single-edit collapse).
- Multi-tap control-panel mode (whatever flag is chosen) still works — repeat presses fire repeat callbacks, keyboard persists.
- Tests cover: one-shot collapse path, multi-tap persistence path, and the highlight-then-collapse timing (use fake timers).

## Implementation notes

- Likely two `editMessageReplyMarkup` calls in sequence with a `setTimeout` between them, OR one `editMessageText` with the highlight markup followed by a delayed `editMessageText` clearing markup. Either way, the second edit must include `inline_keyboard: []` per the lesson from 05-0825.
- `buildHighlightedRows` needs revising — currently returns all-primary; should return chosen-styled + others-defaulted. The "others-defaulted" style for inline buttons in Telegram is the absence of any explicit style emoji prefix the bridge currently injects (verify in `src/tools/send/styles.ts` or wherever style-to-label transformation happens).
- Watch for race: a fast user could tap a different button between step 1 and step 2. Decide intended behavior (probably ignore — the keyboard is collapsing — but document).

## Lessons / don'ts

- `editMessageText` does NOT clear inline keyboards by itself (per 05-0825). Always pass `reply_markup: { inline_keyboard: [] }` explicitly when you want the keyboard gone.
- Do NOT regress `send(type: "question")` — operator explicitly called out that path as feeling great.
- Do NOT remove the multi-tap control-panel capability — it's a documented feature.

## Verification (operator iteration)

Operator is keeping Worker 1 online specifically to iterate on this. After implementation lands, Curator session will demo by sending a `send(type: "choice")` with 3+ options; operator picks one and confirms the highlight-then-collapse animation looks correct. Be prepared for 1–3 visual-tuning rounds.

## Out of scope

- Telegram API limits / "true inert button" research — already done this session, conclusion: not possible. See operator transcript on 2026-04-25.
- Changing button colors to anything outside Telegram's supported style set (primary/success/danger).
- Animation effects beyond the two-stage edit (no per-frame fades — Telegram doesn't support that).

## Related

- 05-0825 (sealed) — keyboard removal on `question` answer; references `choice.ts` intentional divergence.
- `feedback_callback_ack_first` — ack first, mutation second.

## Branch

`05-0830` off `dev`.
