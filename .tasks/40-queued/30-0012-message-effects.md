---
title: "Add message effects (message_effect_id) to text sends — Bot API 7.4"
created: 2026-06-26
status: draft
priority: 30
type: Feature
source: Operator directive — Telegram feature audit triage (2026-06-26)
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
epic: Bot API feature coverage
agent_type: Worker
model_class: sonnet-class
reasoning_effort: low
related:
  - .tasks/10-drafts/15-0011-link-preview-options.md
---

# 30-0012 — Message effects on text sends

## Problem

The bridge sends a lot of status/confirmation messages ("PR merged", "build
green", "deploy done") with no visual emphasis. Telegram's **message effects**
(Bot API 7.4, `message_effect_id`) play a one-shot full-screen animation
(🔥 / 👍 / 👎 / ❤️ / 🎉 / 💩) when a message arrives — a low-cost, on-brand way
to make celebratory or emphatic messages land.

This is pure polish, not function. It's drafted because it's nearly free (one
optional `sendMessage` param) and fits the bridge's status-update role.
**Note:** message effects only render in **private chats** — which is exactly the
bridge's 1-on-1 DM model, so this works for the primary use case.

## Goal

Let the agent attach a named effect to a `send` text message via a friendly
preset name, mapped to the underlying `message_effect_id`.

## Proposed parameter

On `send` (`src/tools/send.ts`), text path:

```
effect: z.enum(["fire", "thumbs_up", "thumbs_down", "heart", "celebrate", "poop"]).optional()
```

Maps to `message_effect_id` on the `getApi().sendMessage(...)` call.

**Effect IDs (⚠️ verify before shipping).** These are well-known but
*undocumented* constants — Telegram does not expose a "list effects" Bot API
method. Confirm each against a live private chat during implementation:

| preset | emoji | message_effect_id (verify) |
| --- | --- | --- |
| fire | 🔥 | 5104841245755180586 |
| thumbs_up | 👍 | 5107584321108051014 |
| thumbs_down | 👎 | 5104858069142078462 |
| heart | ❤️ | 5044134455711629726 |
| celebrate | 🎉 | 5046509860389126442 |
| poop | 💩 | 5046589136895476101 |

Centralize the map in one module (e.g. `src/message-effects.ts`) so it's a single
place to correct if Telegram changes the constants.

## Integration points

- `src/tools/send.ts` — add `effect` to the schema; resolve preset → id; pass
  `message_effect_id` to the direct `getApi().sendMessage(...)` (~line 573).
- Failure tolerance: if Telegram rejects an unknown/stale effect id, it returns a
  400. Catch and **retry once without the effect** rather than failing the whole
  send — the message matters more than the animation. Emit a service-message
  note that the effect was dropped.

## Edge cases

- **Rich-message path**: `message_effect_id` support on rich messages is
  unconfirmed. When `effect` is set, force the plain send path.
- **Multi-chunk**: apply the effect to the **last** chunk only (the payoff
  message), not every chunk — avoids a barrage of animations.
- Effects are silent no-ops in group chats; since the bridge is DM-first this is
  acceptable, but note it.

## Acceptance criteria

- [ ] `send(text: "PR merged", effect: "celebrate")` plays the 🎉 effect in a
      private chat.
- [ ] All six presets verified against a live chat and mapped correctly.
- [ ] A rejected/stale effect id falls back to a normal send (message still
      delivered) with a service-message note.
- [ ] Effect applies to the last chunk only on multi-chunk sends.
- [ ] Plain path forced when rich messages are enabled and `effect` is set.
- [ ] `pnpm build` clean; `pnpm test` passes.
- [ ] PR staged against `dev`. Do NOT merge.

## Scope boundary

- Text sends only — no effects on files, albums, or interactive types.
- No dynamic effect discovery (Bot API has no list-effects method).

## Notes

- grammY 1.43 `sendMessage` options include `message_effect_id` (Bot API 7.4).
- Lowest-stakes item in the audit triage — treat as a small polish PR.

## Overseer review

- reviewer: Overseer
- date: 2026-06-28
- verdict: PASS
- review type: inline gate (polish feature, low risk)
- checked: ACs binary (effect plays in private chat, all 6 presets verified live, stale-id fallback, last-chunk-only, plain-path forced when rich enabled, build+test clean, PR staged not merged), scope = send.ts text path + new constants module, delegation correct, no open questions; effect ID verification is worker responsibility during impl
