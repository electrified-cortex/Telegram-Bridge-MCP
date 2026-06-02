---
id: 15-0824
title: react — fallback for unsupported emojis with hint to caller
priority: 15
status: draft
type: bug-fix
delegation: any
---

# react — emoji fallback with caller hint

When `action(type: 'react', emoji: ...)` is called with an emoji Telegram does not allow as a reaction (e.g. ear/listening 👂, hand 🤚, less common variants), the call should not silently fail or surface as an error. Instead, the bridge should remap to a semantically similar supported emoji, apply the reaction, and return a hint in the response telling the caller what happened.

## Trigger

Operator (distilled): agents often send a reaction emoji that does not exist as a Telegram reaction — e.g. an ear to signal listening to an audio message, which is a nice intent but invalid. The bridge should adapt by mapping such emojis to a supported analog: the call still succeeds, but returns a hint noting the requested emoji is unavailable and that an alternative (e.g. eyes) was used instead.

The agent's intent (acknowledge by listening / processing) is good — Telegram's reaction set is the constraint. The bridge already has the supported emoji set; it can map sensibly.

## Behavior

1. Caller sends `react` with an unsupported emoji (e.g. 👂).
2. Bridge looks up emoji in supported reaction set.
3. If unsupported, look up semantic alias map (e.g. 👂 → 👀, 🤚 → 👍, ...).
4. Apply the alias's reaction. Return:
   ```json
   {
     "ok": true,
     "applied": ["👀"],
     "hint": "no_emoji_fallback",
     "hint_detail": "👂 is not a supported Telegram reaction. Used 👀 (closest semantic alias). To suppress this hint, send 👀 directly."
   }
   ```
5. If no alias mapped, return error (current behavior) with same hint structure.

## Alias map (initial proposal)

Curate a small, opinionated list. Don't try to cover every emoji — only ones agents reach for and Telegram doesn't accept.

- 👂 (ear, listening) → 👀 (eyes, processing)
- 🤚 (hand raised) → 👍 (ack)
- 🧠 (brain, thinking) → 🤔 (thinking face — verify Telegram supports it)
- 👁 (eye, single) → 👀 (eyes)
- 🦻 (ear with hearing aid) → 👀

Keep map data-driven (JSON or TS const), easy to extend.

## Out of scope

- Don't auto-resolve every unsupported emoji. Only ones with a clear semantic intent — leave random/unknown emojis as errors (don't fabricate intent).
- Don't change the error path for genuinely malformed input.

## Acceptance criteria

- Calling react with an aliased emoji returns ok:true, applied:[<alias>], hint, hint_detail.
- Calling react with a supported emoji returns ok:true, applied:[<emoji>], no hint.
- Calling react with an unsupported AND unmapped emoji returns the existing error.
- Tests cover all three paths.
- Alias map is in a single file, documented.

## Related

- `help(topic: 'reactions')` — current reaction protocol; update to mention fallback behavior once shipped.
- Telegram Bot API `setMessageReaction` — authoritative supported-reaction list.

## Completion

Branch: `15-0824`
Commit: `95f1fb2`

Changes:
- `src/tools/react/set.ts`: Added `UNSUPPORTED_EMOJI_ALIASES` const; alias resolution falls through normal routing logic (temp/permanent) so TEMPORARY_BY_DEFAULT and caller params respected. Hint name: `emoji_alias_applied`.
- `src/tools/react/set.test.ts`: Tests for all 3 paths (aliased, supported, unmapped) + alias+temporary:true/false, alias+hasBaseReaction=false.
- `docs/help/reactions.md`: Documented fallback behavior and response shape.

All acceptance criteria met. 2758 tests pass, lint clean.
