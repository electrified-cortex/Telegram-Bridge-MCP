---
id: "10-3026"
title: "Story: auto-Thinking on dequeue — native draft Thinking as base presence (agent-extensible)"
type: story
created: 2026-06-26
status: draft
priority: 15
epic: 10-3001
depends_on:
  - 10-3017   # Stage 2 (rich <tg-thinking>) rides the rich spikes; Stage 1 is independent
related:
  - 10-3019   # stream:true reveal — the sibling that fills the bubble after Thinking
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
source: "Operator design session 2026-06-26 (streaming / presence investigation)"
---

# 10-3026 — Auto-Thinking on dequeue (native draft Thinking as base presence)

Kills dead-air. When the agent dequeues actionable operator content, the bridge
**auto-shows Telegram's native Thinking indicator** — zero agent effort. The agent
can **extend/customize** it; any real action supersedes it. This anchors the
streaming family ([10-3019 (parked)](icebox/10-3019-stream-true-server-side-reveal-PARKED.md) reveal is
what *fills* the bubble afterward) and **absorbs the earlier "open/close presence
stream" idea** as its agent-extension layer.

## ✅ Canon — this is the streaming investigation's keeper (2026-06-26)

The long streaming exploration converged here. Decisions, recorded so they aren't
re-litigated:

- **Auto-Thinking (this story) = the deliverable.** Honest "alive" presence during
  the unavoidable thinking latency; zero noise; full curation; ~free.
- **Server-side *reveal* (`stream:true`) = PARKED** ([icebox](icebox/10-3019-stream-true-server-side-reveal-PARKED.md)).
  Cosmetic — animates already-finished text, *adds* latency, isn't real streaming.
- **True token-streaming (out-of-band SDK/`stream-json` tee) = REJECTED by design.**
  Technically possible, but for an agent→operator bridge it firehoses the agent's
  raw cognition (noise) and destroys the curation that makes the bridge pleasant.
  "Proper LLM chat" is the wrong target here — the agent *deciding what to send* is
  the feature. Not filed; do not scope.

## The native engine

Telegram now has a real "thinking" indicator — but it's a **draft** feature, not a
chat-action:
- **`sendMessageDraft` with empty text → native "Thinking…" bubble.** Bot API 9.5
  (Mar 2026) — **available now**.
- **`sendRichMessageDraft` → `<tg-thinking>` / `RichBlockThinking`** block. Bot API
  10.1 — the Stage-2 upgrade (custom thinking text).

Draft-bound ⇒ **DM-only** (fine — 1-on-1 bridge) and ephemeral (~30s).

## Auto behavior (the default — zero agent effort)

- **Trigger:** a dequeue that returns **actionable operator content** (a message
  the agent will respond to). **NOT** on empty/timeout dequeues or pure
  service-message pulls — otherwise you flash a thinking bubble at nothing.
- **Show** the native Thinking draft immediately.
- **30s = the default hold *and* the refresh floor.** A single un-updated draft
  auto-expires after ~30s — the default needs **no timer**: fire once, let Telegram
  expire it. To hold longer (extend, or a refresh), the bridge tracks a logical
  **`hold-until`** deadline and re-sends the draft within each ~30s window to
  sustain it.
- **Timer semantics = a floor, never a cap (`max`, never shorten).** A refresh sets
  `hold-until = max(hold-until, now + 30s)` — it *tops up* a near-expiry Thinking to
  ≥30s but **never diminishes a longer active hold**. If the agent extended Thinking
  to 2 minutes, a new actionable dequeue leaves the 2-minute hold intact; if only
  ~8s remained, it bumps back to 30s. Refreshes only ever raise the floor.
- **Supersession / precedence:** Thinking is the **lowest-priority presence
  state** — the "I've got it, nothing more specific yet" placeholder. It is
  cancelled/superseded by ANY higher action: `show_typing`, a `send`/reveal, an
  animation, a reaction, TTS record_voice, etc. Slots into the existing
  `typing-state` / `animation-state` precedence stack as the base layer.
- **Lifecycle mirrors the agent:** `dequeue → 💭 Thinking… → ✍️ typing… → message`.
- **Clean cancel, no flash:** when a higher action fires within the first instant,
  dismiss the Thinking draft *before* the new state shows (see spike on early
  dismissal).

## Supersession taxonomy — what cancels Thinking vs. what doesn't

**Principle:** Thinking means *"received, reasoning — the response isn't out yet."*
It is cancelled ONLY by an action that puts the agent's **response or active
composition** in front of the operator. Everything the agent does to *prepare* the
response leaves Thinking up — it's still working toward the answer.

**Implementation rule — default-DON'T-cancel (allow-list the cancellers).** Most of
the tool surface is internal; only a handful of actions are operator-facing
responses. Mark those explicitly; everything unmarked leaves Thinking standing.
Safe failure mode = Thinking lingers a few extra seconds (30s-expires anyway),
*not* vanishing on an internal call.

| Class | Actions | Effect |
|---|---|---|
| **Cancels / transitions** | `send` (text/file/voice/notification/dm), `send(choice/question/confirm/checklist/progress)`, `stream:true` reveal, `show_typing` / TTS record, `animation` show | ✖ supersede — response/active-composition now visible |
| **Refreshes (not cancel)** | another `dequeue` returning **actionable** content | ↻ floor at 30s: `hold-until = max(hold-until, now+30s)` — tops up a near-expiry hold, **never shortens** a longer one |
| **Leaves Thinking up** | `help`, `download_file`, `transcribe`, `chat/info`, `message/get`/`history`, `session/*`, `profile/*`, `reminder/* (set/list/…)`, `log/*`, `activity/*`, `commands/set`, identity/auth, `acknowledge` | ○ no change — preparing the response |
| **Ambient (leaves up)** | `react` / `set_reaction`, `message/pin`/`edit`/`delete` (ops on *prior* messages) | ○ acks / edits to other messages aren't *this* response |

Edge cases to resolve per-action in impl: `session/spawn-child` and `reminder/set`
may emit their *own* operator-facing service messages — that **service message** is
the operator-facing part (and supersedes); the management action itself does not.

## Agent awareness + extension (first-class requirement)

The agent MUST be aware this exists and be able to **use and extend** it:

- **Aware:** the agent understands auto-Thinking fires on dequeue, lasts ≤30s, and
  is superseded by its actions — so it can reason about the operator's view.
- **Extend / customize** (the agent takes over the auto-started Thinking):
  1. **Keep alive past 30s** — for a longer reasoning/work period (bridge refreshes
     the draft within the 30s window autonomously; agent doesn't ping).
  2. **Label it** — e.g. `"Analyzing the codebase…"` instead of generic "Thinking…"
     (rich `<tg-thinking>` carries custom text; plain draft is generic).
  3. **Phase-script it** — provide `["Reading files","Running tests","Drafting"]`;
     the **bridge cycles** them on its own timer. **One call**, live-looking stages,
     one model round-trip.
  4. **Close it** explicitly, or let the next real `send` auto-close it.
- **Surface (decide in impl):** an `action(type:"thinking", label?, phases?, hold?)`
  or `stream/open`-style call — one call to take over, bridge owns the rest. Must
  stay token-cheap (open + close = 2 round-trips regardless of hold duration; the
  keep-alive is bridge-side).

## Help + docs (deliverable, not optional)

- **`help('thinking')` topic** — the lifecycle (auto on dequeue → ≤30s → superseded),
  how to extend (label / phases / hold / close), the DM-only + 30s constraints,
  and worked examples. Mirror the depth of `help('dequeue')` / `help('startup')`.
- **Update `help('streaming')` and `help('dequeue')`** to reference it.
- **Surface `append` (Journey 2)** in `help('streaming')` — the token-cheap way to
  grow a message across real work steps ("✓ found bug", "✓ patch applied"). This is
  the one useful bit carried over from the parked reveal story: no engine work, just
  advertise that `append` exists as the progress path.
- **Schema hints** on the thinking/extend action so the agent discovers it at
  tool-load (self-documenting, like `type:"file"`).

## Two-stage engine

- **Stage 1 (now):** `sendMessageDraft` empty-text "Thinking…". No rich-pivot
  dependency — ships independently. Generic bubble; phase-script via swapping
  short text bodies if the plain draft allows, else generic.
- **Stage 2 (rides rich pivot 10-3017/10-3018):** `sendRichMessageDraft` +
  `<tg-thinking>` for custom thinking text / richer states. Same agent contract.

## Spikes

- **Draft early-dismissal** — how to cancel a Thinking draft *before* its 30s when
  a higher action supersedes it. Does sending the real message auto-clear the
  draft, or is there an explicit clear/delete? (Docs cover create/update/persist,
  not early-dismiss.) Determines whether supersession is flash-free.
- **Precedence integration** — wire Thinking as the base state in
  `typing-state`/`animation-state` so existing indicators evict it correctly.

## Inbound streaming ("manage this as well") — honest scope

Operator desire: stream *input* and manage presence against it. Hard limit:
**the Bot API gives bots NO inbound "user is typing" signal** — bots cannot see the
operator composing (that's MTProto/user-client only). So true "react to the
operator typing" is **not possible** for a bot.

What *is* achievable and worth a follow-up: **manage Thinking across inbound
message bursts.** When the operator fires several messages rapidly, the bridge's
existing debounce/batching can **hold the Thinking state until the burst settles**,
then let the agent respond once — so presence tracks the inbound flow as closely as
a bot can. Captured here as a **related future item**, not built in this story.

## Acceptance criteria

- [ ] Actionable dequeue → native Thinking bubble appears automatically (Stage 1
      `sendMessageDraft`, no rich-pivot dependency).
- [ ] Empty/timeout/service-only dequeues do NOT trigger Thinking.
- [ ] Thinking auto-expires by ~30s with no timer in the default case (native
      ephemerality).
- [ ] Refresh is a floor, never a cap: `hold-until = max(hold-until, now+30s)` — a
      new actionable dequeue tops up a near-expiry Thinking but never shortens a
      longer hold the agent extended.
- [ ] Supersession follows the taxonomy: only allow-listed response/composition
      actions (`send`/reveal, `show_typing`/TTS, `animation`) cancel/transition
      Thinking cleanly (no flash); **`help`, another `dequeue`, and internal
      reads/management do NOT cancel it** (default-don't-cancel). Reactions and
      edits to prior messages leave it up.
- [ ] Agent can extend: set a label, provide a bridge-cycled phase-script, hold
      past 30s, and close — token-cheap (open+close = 2 round-trips).
- [ ] `help('thinking')` exists; `help('streaming')`/`help('dequeue')` cross-link;
      the extend action is discoverable from its schema.
- [ ] `pnpm build` clean; `pnpm test` passes. PR staged, not merged.

## Out of scope

- Inbound typing detection (Bot API can't — see above).
- Group/channel Thinking (drafts are DM-only) — no indicator there.
- The message reveal itself — that's [10-3019 (parked)](icebox/10-3019-stream-true-server-side-reveal-PARKED.md).
- Managing Thinking across inbound bursts — related future item (debounce-driven).

## Notes

- Reuses `showTyping`/presence infra and the async/draft machinery; the 30s cap is
  free (native). The win is large (universal dead-air fix) for a small surface.

## Overseer review

- reviewer: Overseer
- date: 2026-06-28
- verdict: PASS
- review type: inline gate (Stage 1 independently shippable)
- checked: ACs binary (auto-Thinking on actionable dequeue, NOT on empty/timeout/service, 30s natural expiry, floor-not-cap refresh semantics, supersession taxonomy, agent extension contract, help topic deliverable, build+test), Stage 1 has no rich-pivot dependency — ships now; Stage 2 rides 10-3018
- note: two spikes (draft early-dismissal, precedence integration) are worker-resolvable during impl — not blocking open questions
