---
id: "10-3019"
title: "Story: stream:true — server-side reveal via native message drafts (token-neutral)"
type: story
created: 2026-06-26
status: parked
priority: 60
epic: 10-3001
depends_on:
  - 10-3017   # Stage 2 (rich draft) rides the rich-messages spikes; Stage 1 is independent
related:
  - 10-3018   # supersedes its thin "migrate stream/*" bullet
  - 10-3026   # auto-Thinking on dequeue — the presence anchor; reveal fills its bubble
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
source: "Operator design session 2026-06-26 (streaming investigation)"
---

> ⏸️ **PARKED — design decision 2026-06-26 (do not build; do not re-litigate).**
> The streaming investigation concluded that **reveal is cosmetic**: it animates
> *already-finished* text, which *adds* latency and does **not** deliver real
> streaming (the operator still waits the full generation time, hidden behind
> "Thinking…"). True token-streaming (the out-of-band SDK/`stream-json` **tee**)
> was considered and **REJECTED** — for an agent→operator bridge it would firehose
> the agent's raw cognition (false starts, tool planning, reasoning) = noise, and
> it would destroy the *curation* (agent thinks privately, sends a clean message)
> that makes the bridge pleasant. "Proper LLM chat" is the wrong target here.
>
> **The keeper from this investigation is [10-3026](10-3026-auto-thinking-on-dequeue.md)
> — auto-Thinking on dequeue** — which gives the honest "alive" feel during the
> unavoidable thinking latency, with zero noise and full curation. The `append`
> discoverability bit (Journey 2) survives in 10-3026's help/docs deliverable.
> This story is retained for history only.

# 10-3019 — `stream:true`: server-side reveal via native message drafts

Canonical streaming spec for TMCP. Supersedes the thin "migrate `stream/*` to
`sendRichMessageDraft`" bullet in [10-3018](10-3018-v8-rich-messages-native-implementation.md)
with the design that preserves token conservation.

## The contract (agent-facing — one knob)

- `type:"text"` (and `markdown` / `html` / "text that ends up markdown") is
  **instant by default**.
- **`stream:true`** opts into a progressive *reveal*. `stream` absent or `false`
  → send instantly, exactly as today.
- The agent **never names a draft API**. It expresses intent (`stream:true`); the
  bridge owns the mechanism (engine choice, segmentation, animation, persist,
  fallback).
- **Scope:** `type:"text"` only. `notify` / `progress` / `choice` / `file` / voice
  / service-messages stay instant — animating a progress bar or button prompt is
  wrong.

## Why this is token-neutral (the whole point)

The expensive trap: an agent driving the reveal (`stream/start → chunk×N → flush`)
is **N model round-trips** — each chunk re-runs the model over the growing
context. That multiplies tokens and violates the conservation ethos.

This design instead: the agent emits the **complete** text in **one** `send`
(one model round-trip, normal token cost). The **bridge** performs the reveal by
pushing N draft updates — those are *network/API calls, not model tokens*. So
streaming costs the agent nothing beyond a normal send.

> **Principle:** the agent emits a complete thought once; the bridge decides how
> it appears. Reveal is a delivery mode, not an agent behavior.

## Two journeys, one engine

- **Journey 1 — reveal (`stream:true`):** bridge **auto-segments** the finished
  text and reveals it. The common case.
- **Journey 2 — progress (`append`):** the agent **manually** appends segments
  across real work steps it is already taking (so no *extra* round-trips). Use for
  long tasks ("✓ found bug", "✓ patch applied", "running tests…").

Both are the same primitive — *append a valid segment to a growing message*. One
drives it automatically (bridge), the other manually (agent).

## Auto-selected draft engine (the ladder)

On `stream:true`, the bridge selects automatically — agent is oblivious:

1. **Rich content in a DM, rich available** → `sendRichMessageDraft` (animated,
   GFM, tables render, native `<tg-thinking>` "Thinking…" state).
2. **Plain / simpler text in a DM** → `sendMessageDraft` (animated, legacy `parse_mode`).
3. **Drafts unavailable** (not a private chat, unsupported client) → graceful
   fallback to **instant send** (never fail, never block). Optionally the legacy
   `editMessageText`-reveal as a choppy floor if desired.
4. **Always** → persist the final complete message with `sendRichMessage` /
   `sendMessage`, then return the real `message_id`.

## Two-stage rollout (decoupled from the rich pivot)

- **Stage 1 — `sendMessageDraft` (independent of the rich pivot).** Shipped in
  **Bot API 9.5 (Mar 2026)**, supports `parse_mode`, in grammY 1.44. Gives native,
  animated, no-flicker streaming **today** via the existing markdown→V2 path. No
  dependency on the 10-3017 spikes.
- **Stage 2 — `sendRichMessageDraft` (rides the rich pivot).** After 10-3017/10-3018
  land, the bridge silently upgrades `stream:true` to the rich draft (no escaping,
  tables render, `<tg-thinking>`). **Same agent contract** — the agent never knows
  which stage it's in.

## Smart segmentation (the crux — correctness, not just aesthetics)

You **cannot** reveal arbitrary character prefixes: partial markup is *invalid*
markup. `"the result is **import"` has an unclosed `**` → Telegram 400s
("can't parse entities") or renders raw asterisks. A half-revealed table is a
grid of stray pipes; a mid-reveal fenced block leaves an unterminated ```` ``` ````;
a split HTML tag leaks `<b`. **Every revealed frame must be a complete, valid,
renderable string.**

So the reveal is **markup-aware**. Segment the finished text into:

- **Streamable** — plain prose, with inline emphasis revealed only at **balanced**
  points. Reveal finely (word/sentence), never emitting an unbalanced state.
- **Atomic** — appended **whole**, never partially: **tables, fenced code blocks,
  any HTML/other tag or element, links, images, blockquotes, math**. These
  "pop in" intact — which is the correct UX, not a compromise.

Reveal = stream prose at safe boundaries → hit an atomic block → drop it in as one
segment → resume. Each draft update is a valid body the parser accepts. (This is
also exactly what makes the draft API safe to drive — every update parses.)

## Delivery mechanics

- Runs on the existing **async-send-queue**: return `message_id_pending`
  immediately, perform the reveal in the background (agent not blocked). Preserves
  text-after-voice ordering.
- **Persist-through:** the final persisted message must be **byte-identical to a
  normal send** — carry `reply_markup` (copy_text buttons), `message_effect_id`,
  reply-to, and the session/topic header. Reveal animates *delivery*; the end
  state is unchanged.
- Throttle draft updates (reuse / add `@grammyjs/transformer-throttler`) and pair
  with `@grammyjs/auto-retry` for 429s.

## Constraints / caveats

- **DM-only:** drafts require a numeric private `chat_id` — fine for this 1-on-1
  bridge; the fallback (rung 3) covers anything else.
- **30-second ephemerality:** drafts are a temporary preview — keep updates
  flowing or finalize promptly; always persist with the real send.
- **Rate limits undocumented for drafts** — the docs promise no exemption. Measure
  `retry_after` empirically before loosening cadence (spike below).
- **Multi-chunk (>4096):** decide reveal behavior when the text exceeds one
  message (reveal first message, send rest? reveal each?). Specify during impl.

## `append` discoverability (Journey 2 — mostly a docs move)

`append_text` already exists (O(1)-token delta edit). The gap is the agent not
knowing it's the cheap progress path. Surface it: add to `help('streaming')` and
the send-schema hints — "use `append` to grow a message across steps you're
already taking." No engine work; just advertise it.

## Spikes

- **Draft rate-limit behavior** — measure actual `429`/`retry_after` on rapid
  `sendMessageDraft` updates; set a safe cadence. (Can fold into 10-3017.)
- **Partial-frame validity** — confirm the segmenter's intermediate frames parse
  cleanly under both legacy `parse_mode` (Stage 1) and rich markdown (Stage 2).

## Acceptance criteria

- [ ] `send(type:"text", stream:true)` reveals progressively; without `stream` it
      sends instantly (no behavior change to today's default).
- [ ] The reveal uses a **native draft** (`sendMessageDraft` Stage 1 /
      `sendRichMessageDraft` Stage 2), auto-selected — agent never names the API.
- [ ] **No partial-markup frame is ever emitted** — tables, fenced code, tags,
      links, blockquotes, math reveal as whole atomic segments; prose reveals only
      at balanced boundaries. (Test: a message with a table mid-text never shows a
      broken table; an unclosed `**` is never sent.)
- [ ] Token cost = a single send (one model round-trip); the bridge performs the
      N draft updates.
- [ ] Persisted final message is byte-identical to a normal send (buttons/effects/
      reply/topic-header intact); real `message_id` returned.
- [ ] Graceful fallback to instant send when drafts are unavailable; never fails.
- [ ] Runs on the async-send-queue; ordering with voice preserved.
- [ ] `help('streaming')` documents `stream:true` (reveal) and `append` (progress).
- [ ] `pnpm build` clean; `pnpm test` passes. PR staged, not merged.

## Out of scope

- True token-by-token streaming (operator sees output *as the model generates*) —
  impossible via MCP; would require an out-of-band HTTP tee of Claude Code's
  `stream-json` or a direct Messages API integration. Separate exploration.
- Group/channel streaming (drafts are DM-only) — instant send there.
- The silent-unknown-param footgun (a `stream` typo on a non-text type is silently
  ignored) — worth a tiny separate guard so a bad flag gets feedback, not a no-op.

## Supersedes

- The "migrate `stream/*` to `sendRichMessageDraft`" bullet in 10-3018 P5. That
  framing kept the agent-drives-chunks model (token-expensive). This story makes
  reveal a **bridge-side delivery mode** on `send(stream:true)`; the agent-driven
  `stream/*` tools are repositioned for Journey-2 progress only.
