# telegram-mcp-communication — uncompressed

## What this skill governs

Canonical communication conventions for Telegram bridge MCP agents: tool selection, reply routing, modality choices, button design, async wait etiquette, and voice handling. Not covered here: session lifecycle, recovery flows, or the dequeue loop itself (separate skills).

## Tool selection

| Situation | Call |
| --- | --- |
| Pure acknowledgment | `action(type: "message/react", emoji: "...")` |
| Conversational reply | `send(type: "text", audio: "...")` |
| Structured / Markdown content | `send(type: "text", text: "...")` |
| Yes / No decision | `send(type: "question", confirm: "...")` |
| Fixed options (blocking) | `send(type: "question", choose: [...])` |
| Non-blocking shortcuts | `send(type: "choice", text: "...", options: [...])` |
| Open-ended input | `send(type: "question", ask: "...")` |
| Short status | `send(type: "notification", text: "...", severity: "info")` |
| Multi-step tracked workflow | `send(type: "checklist", title: "...", steps: [...])` |
| Non-content operations (reminders, profile, animation) | `action(...)` |

Use `action` for operations that do not produce conversational content. Use `send` when the agent is addressing the operator.

## Modality priority

For soliciting decisions: buttons > text > audio.
For delivering nuance or narrative: audio > text > buttons.

Pick the highest-priority modality the situation supports. When in doubt for conversational replies, default to voice (audio param).

## Hybrid sends: audio and caption are COMPLEMENTARY

Audio and caption must never duplicate each other. Audio carries lower-priority / conversational content in plain English. Caption carries highest-priority structured content (paths, IDs, hashes, links). If both say the same thing, one is waste.

Example: audio narrates the overall situation; caption lists the specific commit SHA or file path that needs operator attention.

## Button design

Buttons work when the answer set is bounded and known at send time. Use them when tap speed matters.

| Scenario | Tool |
| --- | --- |
| Destructive or irreversible | `confirm` (blocking) |
| 2-6 mutually exclusive options needing definitive answer | `choose` (blocking) |
| Shortcuts operator may ignore | `choice` (non-blocking) |
| Freeform answer | `ask` — no buttons |
| Informational only | no buttons |
| More than 6 options | `ask` — buttons do not scale |

Column count: match label length. Long labels -> 1 column (max ~35 chars). Standard labels -> 2 columns (max ~20 chars). Short / icon labels -> 3 or 4 columns.

Timeout recovery: on `timed_out`, surface the timeout to the operator. Never silently proceed with a default.

## Routing

Ambiguous messages (no clear target) go to the governor session. Targeted messages go to their target. DMs to peer sessions use `type: "dm"` with `target_sid`.

## Voice handling

Voice messages are auto-reacted by the bridge (transcribing then salute). Agents do not duplicate the auto-salute. Reply to voice with voice or a hybrid (audio + brief caption).

## Async wait etiquette

1. Fire persistent animation: `send(type: "animation", preset: "waiting", persistent: true)`.
2. Stay in the dequeue loop.
3. Brief status check-in after each poll cycle (do not go silent).
4. Handle any operator message that arrives mid-wait immediately.
5. Cancel animation before sending a substantive reply: `action(type: "animation/cancel")`.

## Cross-references

`help('send')` — send parameters.
`help('reactions')` — reaction protocol.
`help('modality')` — modality decision guidance.
`help('audio')` — audio content rules.

## Don'ts

- Do not prescribe a single style (audio-only, text-only) — modality priority drives the choice.
- Do not send long text walls. Compress structured info; if it overflows a Telegram screen, it belongs in audio or a file.
- Do not use workspace-specific role labels in these conventions — use "agent", "operator", "peer session".
- Do not duplicate `help()` topic content verbatim — point to it.
