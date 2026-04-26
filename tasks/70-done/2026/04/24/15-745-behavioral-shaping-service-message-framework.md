# 15-745 — Behavioral-shaping service-message framework (reaction + presence)

## Mission

**End the endless repetition of the same behavioral corrections.** Operator has
had to re-teach reaction semantics, presence protocol, and adjacent behavioral
rules across many sessions because corrections live only in per-agent memory
and don't persist across sessions, roles, or agent restarts. The root fix is
not another memory entry. The root fix is a **TMCP-level behavioral shaping
layer** that delivers guidance with the same weight as operator speech.

Operator (2026-04-19, voice 38961): *"You can look up things like reaction.
You can look up responsiveness... the task is to... there should be like a
spec somewhere, it should be in the Telegram MCP."* And voice 38948: *"It's
more important that there's a change in the MCP to fix it."* And voice
38950: *"Stronger things are service messages that tell it 'this is a
behavioral thing you need to adopt.' It's almost as strong as receiving it
from the user."*

Operator (voice 38961, re: this task + 15-746): *"745 and 746. Very much tied
together, right? Why are we not [one task]?"* — consolidated here.

## Scope — Architecture + first two instances

Single unified task because the architecture is shared. Two concrete
behavioral domains ship as the first-class instances; the framework must be
extensible so the Nth correction can land as a data entry, not a new TMCP
feature.

### Part A — Framework

1. **Service-message channel** for behavioral shaping, as strong as user
   speech. Existing compression service-message is the template.
2. **Delivery triggers**: first tool call per session, anomaly detection
   (silent-work threshold, wrong reaction emoji usage, etc.), or explicit
   `behavior/shape` action.
3. **Trailing hint channel** (lighter weight): short nudge appended to tool
   responses when a soft rule is violated (analogous to
   `unrenderable_chars_warning`).
4. **Registry of behavioral rules** — data-driven so new rules can be added
   without code churn. Rule schema: name, severity (hint / service-message),
   trigger (first-call / detector / always), message, alignment with
   `help(topic: ...)` doc.
5. `help(topic: 'behavior')` returns current registry.

### Part B — First instance: reaction semantics

Correct semantics:

- 👌 (OK hand) — **weakest ack**. "Received, no commitment." Not approval.
- 👍 (thumbs up) — **strong ack**. "Received, will do."
- 🫡 (salute) — **auto-fired on voice dequeue** (salute-the-voice protocol).
- ❤️ / higher-valence reactions — reserved for meaning, not decoration.

Common drift: agents confuse 👌 <-> 🆗 (regional indicator), use 👍 for
weakest ack instead of 👌. Correction has been made repeatedly per session.
Not sticky.

Framework wiring:

- Service-message delivered on first `react()` call per session.
- Hint delivered when a non-registered emoji is used without obvious
  intent.
- Aligned with `help(topic: 'reactions')`.

### Part C — First instance: presence protocol

Correct 4-tier hierarchy:

- **Tier 1 — reaction**: instant, semantic ack on inbound message.
- **Tier 2 — show-typing**: fire-and-forget, auto-expires; for short compose
  windows. Safer than persistent — no remember-to-cancel trap.
- **Tier 3 — animation (persistent)**: durable, flagged persistent ONLY when
  work is actively running. **Cancel immediately on transition to dequeue
  wait**, reply send, or any idle state. Persistent animation during idle is
  a visual lie (voice 38942: *"If you lie too long, it becomes not useful
  because the human will start to distrust it."*).
- **Tier 4 — progress**: percentaged long-running work with
  `progress/update`.

Common drift: agents start silent work without Tier 2, leave Tier 3 up
after returning to idle, or skip the hierarchy entirely on compute > 30s.

Framework wiring:

- Silent-work detector (default ~30-60s between inbound and any outbound
  presence signal) → trailing hint (rung 1) then service-message (rung 2).
- Optional: detect persistent animation outliving dequeue-wait and
  auto-nudge or auto-cancel (design risk: false kills — evaluate).
- Aligned with `help(topic: 'presence')`.

## Acceptance Criteria

1. Framework (Part A) implemented: registry + service-message delivery +
   trailing-hint delivery + `help(topic: 'behavior')`.
2. Reaction semantics (Part B) wired through framework. Existing
   `help(topic: 'reactions')` kept in sync.
3. Presence protocol (Part C) wired through framework. Existing
   `help(topic: 'presence')` kept in sync. Silent-work detector already
   exists (rung1/rung2 service messages) — integrate with the new registry
   rather than duplicating.
4. Each rule is addressable: disable / severity-override per session for
   exceptions (rare).
5. No regression in existing behavioral service-messages (compression,
   etc.) — integrate them under the same registry if natural.

## Scope boundary

- TMCP behavioral shaping layer only.
- Do not redesign `react`, `show-typing`, `animation/*`, `progress/*`
  primitives.
- Do not modify per-agent memory files. The premise of this task is that
  memory-layer has repeatedly failed to stick.

## Related / Supersedes

- **Supersedes** `15-746-presence-protocol-service-message.md` (merged here per
  operator directive, voice 38961).
- **Supersedes** earlier skill-level draft `.agents/tasks/1-drafts/
  15-585-presence-protocol-skill.md` (per-agent skill approach tried and
  failed to persist).

## Priority

15 — Behavioral correctness. Recurring operator correction cost is the
signal memory-layer fixes aren't enough.

## Delegation

Worker picks up Part A framework. TMCP maintainer reviews. Parts B and C
are wired-in-instances; can ship with Part A or as follow-on drops.

## needs refinement

- Exact registry schema (JSON? TS type?).
- Whether to integrate existing silent-work detector or rebuild.
- Auto-cancel-stale-animation safety evaluation.

## Completion

- **Branch:** `15-745` in `Telegram MCP/.worktrees/15-745`
- **Commit:** `871987a` — feat(15-745): behavioral-shaping registry + reaction semantics + presence tier 4
- **Decisions:**
  - Registry schema: TypeScript `BehaviorRuleSpec` interface with `name/description/severity/trigger/eventType/helpTopic` — typed, not JSON
  - Silent-work detector: integrated by registering existing rung1/rung2 rules as entries (no rebuild; detector code unchanged)
  - Auto-cancel-stale-animation: deferred per task spec — too much false-kill risk
  - Forward-doc entries (15-713/15-714 compression/modality rules) removed from registry to avoid inconsistency; tasks 15-713/15-714 will add their own entries on merge
- **Files:** `src/behavior-registry.ts` (new), `src/service-messages.ts`, `src/server.ts`, `src/tools/help.ts`, `docs/help/behavior.md` (new), `docs/help/reactions.md`, `docs/help/presence.md`
