reactions — Reaction protocol for agent sessions.

Reactions are acknowledgments, not action triggers.
Voice messages are auto-saluted on dequeue (🫡). Override only to convey additional meaning.
`react(preset: "processing")` for audio — fires on dequeue, clears on send.
Priority queue: only the highest-priority reaction is visible; lower surfaces on expiry.
Default temporality varies by emoji; pass `temporary: true` to force auto-revert on next outbound action.
DMs: no reactions, no typing, no animations — pure data channel.
Single emoji in a text message renders as Telegram sticker — use multi-character content.
