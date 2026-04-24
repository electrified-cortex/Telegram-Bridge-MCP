reactions — Reaction protocol for agent sessions.

Reactions are acknowledgments, not action triggers. Never mutate state from a reaction.

## Emoji semantics

| Emoji | Meaning | When to use |
|---|---|---|
| 👌 | Weakest ack — "received, no commitment" | Message noted; not committing to action |
| 👍 | Strong ack — "received, will do" | Committing to act on this message |
| 🫡 | Auto-salute — auto-fired on voice dequeue | Do not send manually; override only to convey meaning beyond receipt |
| ❤️+ | Reserved for meaning | High-valence reactions; use sparingly and only when the emotion is real |

Common drift: confusing 👌 with 🆗 (regional indicator); using 👍 as the default/weakest ack. 👌 is weakest; 👍 commits.

## Voice vs. text

- **Voice messages** are auto-saluted on dequeue with 🫡. Override only when you need to convey additional meaning (e.g. `react(preset: "processing")` during long work).
- **Text messages** get no automatic reaction beyond the implicit base — call `react(...)` when an ack is useful.

## Presets

- `react(preset: "processing")` — voice-work idiom. Fires 👀 (eyeballs, priority 1, auto-clears after 10s) + 🤔 (thinking, priority 0, clears on next outbound action). Use on dequeue of an audio message; both layers vanish once you respond.

## Priority queue

- Only the highest-priority reaction is visible at any time; lower-priority reactions surface when the top one clears or expires.
- An implicit base reaction 👌 is inserted at priority -100 on first reaction per message — ensures the bot never leaves a message reaction-less.
- When all higher layers clear, the base becomes visible.

## Temporality

- Some emojis are temporary by default: 🤔, 👀, ⏳, ✍, 👨‍💻. They auto-revert on the next outbound action from your session.
- All other emojis are permanent by default.
- Pass `temporary: true` to force auto-revert, or `temporary: false` to pin a normally-temporary emoji. Explicit always wins.

## Constraints

- **DMs**: no reactions, no typing indicators, no animations — DMs are a pure data channel.
- **Single emoji in a text message** renders as a Telegram sticker, not a message. Use multi-character content (e.g. `👌 done`) when you need a text reply.
