# Task 350 — Reaction Alias Fallback Arrays

## Summary

Change reaction aliases from single emoji strings to ordered fallback arrays. When setting a reaction, try each emoji in order — the first one that succeeds wins. This lets premium bots use ✅ while non-premium bots gracefully fall back to 👍.

## Motivation

PR #51 (from ultrarare-tech) highlighted that ✅ is a custom emoji restricted to premium bots. Their fix was to remap `done`/`complete`/`finished` to 👍 unconditionally. But a smarter approach: try ✅ first, and if the API returns `REACTION_INVALID`, fall back to 👍. This way premium bots still get the richer emoji.

This is analogous to CSS font-family fallbacks: `font-family: "Preferred", "Fallback", sans-serif`.

## Design

### Two Reaction Groups

Telegram restricts certain emojis to premium bots. We define two explicit groups:

**Free reactions** — available to all bots (the default reaction set):
`👍 👎 ❤ 🔥 🥰 👏 😁 🤔 🤯 😱 🤬 😢 🎉 🤩 🤮 💩 🙏 👌 🕊 🤡 🥱 🥴 😍 🐳 ❤‍🔥 🌚 🌭 💯 🤣 ⚡ 🍌 🏆 💔 🤨 😐 🍓 🍾 💋 🖕 😈 😴 😭 🤓 👻 👨‍💻 👀 🎃 🙈 😇 😨 🤝 ✍ 🤗 🫡 🎅 🎄 ☃ 💅 🤪 🗿 🆒 💘 🙉 🦄 😘 💊 🙊 😎 👾 🤷‍♂ 🤷 🤷‍♀ 😡`

**Premium reactions** — require Telegram Premium on the bot account:
`✅` and potentially others (custom emoji reactions).

### Alias Type Change

Each alias maps to an ordered fallback array: `[preferred, ...fallbacks]`.

```ts
const REACTION_ALIASES: Record<string, string[]> = {
  // Premium-preferred with free fallback
  done:     ["✅", "👍"],
  complete: ["✅", "👍"],
  finished: ["✅", "👍"],

  // Free-only aliases — single element, always work
  thinking: ["🤔"],
  working:  ["⏳"],
  love:     ["❤"],
  fire:     ["🔥"],
  // ...
};
```

### Resolution Logic

```ts
function resolveEmoji(input: string): string[] {
  const alias = REACTION_ALIASES[input.toLowerCase()];
  if (alias) return alias;
  // Raw emoji — wrap in single-element array
  return [input];
}
```

### Try-with-Fallback in set_reaction

In the tool handler, when setting a reaction:

```ts
for (const candidate of candidates) {
  try {
    await api.setMessageReaction(chatId, message_id, [{ type: "emoji", emoji: candidate }], { is_big });
    recordBotReaction(message_id, candidate);
    const result: Record<string, unknown> = { ok: true, message_id, emoji: candidate };
    if (candidates.length > 1 && candidate !== candidates[0]) {
      result.requested = candidates[0];
      result.fallback_used = true;
      result.reason = "The preferred emoji requires Telegram Premium. Used the closest free alternative.";
    }
    return toResult(result);
  } catch (err) {
    if (isReactionInvalid(err) && candidates.indexOf(candidate) < candidates.length - 1) {
      continue; // Try next fallback
    }
    throw err; // Last candidate or different error — propagate
  }
}
```

### Return Payload

**Normal (no fallback needed):**
```json
{ "ok": true, "message_id": 1234, "emoji": "✅" }
```

**Fallback used:**
```json
{
  "ok": true,
  "message_id": 1234,
  "emoji": "👍",
  "requested": "✅",
  "fallback_used": true,
  "reason": "The preferred emoji requires Telegram Premium. Used the closest free alternative."
}
```

**Direct emoji (no alias), premium fails:**
→ Error propagates normally. No silent substitution — agent chose a specific emoji.

### Fallback Semantics

Aliases with fallbacks are chosen for semantic proximity (not arbitrary):
| Alias | Preferred | Fallback | Semantic |
|-------|-----------|----------|----------|
| done/complete/finished | ✅ | 👍 | Positive completion |
| working/processing/busy | ⏳ | 🤔 | "Working on it" |
| error/failed/stop/blocked | ⛔ | 👎 | Negative signal |
| rocket/launch | 🚀 | 🔥 | Excitement/momentum |

### Premium Status Caching

After the first successful premium reaction (e.g. ✅), cache that the bot is premium — skip the try/catch loop on future calls and go straight to preferred. Conversely, after a fallback triggers, cache that the bot is non-premium and skip premium emojis in future calls (go straight to free fallback). Cache persists per process lifetime — resets on restart.

## Scope

### Files to Modify
- `src/tools/set_reaction.ts` — change alias type, update resolveEmoji, add fallback loop
- `src/tools/set_reaction.test.ts` — update tests for array aliases, add fallback tests
- `changelog/unreleased.md` — feature entry

## Impact on PR #51

This supersedes PR #51. Close #51 with a thank-you comment explaining we're building a more comprehensive fallback system that preserves premium emoji support. The contributor's find was the catalyst for this improvement.

## Priority

Medium — improves reaction robustness for non-premium bots without losing premium features.
