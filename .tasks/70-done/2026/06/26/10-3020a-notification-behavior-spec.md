---
created: 2026-06-20
status: queued
priority: 5
source: operator voice 76211 — "spec the behavior before fixing"
repo: electrified-cortex/Telegram-Bridge-MCP
type: Spec
agent_type: Curator
model_class: sonnet-class
reasoning_effort: high
epic: 10-3020
blocks: 10-3021, 10-3022, 10-3023, 10-3024, 10-3025, 15-0004
---

# 10-3020a — TMCP Notification Behavior Contract (Spec)

## Design principles (voices 76211, 76216, 76218 — 2026-06-20)

### P1 — Actionability is the filter (76211)
If a notification is not actionable (agent has no meaningful response), MUST NOT wake.

### P2 — Reactions MUST NOT wake (76216, confirmed 76223)
Reactions signal emotion/aesthetic, not direction. A stale reaction (5 messages back)
is irrelevant to the agent. Reactions MUST NOT trigger a notification/wake.
They DO still appear in DQ — the agent can consume them while already running.
This is a confirmed decision, not a "maybe."

### P5 — Reactions are NEVER confirmation signals (76229)
Agents MUST NOT interpret any reaction (including affirmative ones like 👍 or 💯) as
confirmation of intent. Reactions are agreement/flavor only. This is already established
in existing skills/comms spec — reactions are never confirmation signals.
The spec must cross-reference the existing skills language and reinforce this as an
invariant. An agent that blocks on a reaction for confirmation is operating incorrectly.

### P4 — Reactions are DQ-batched, not individual events (76226 via Curator)
Reactions between two real messages MUST be coalesced into a single DQ delivery unit.
"Flood" pattern: accumulate reactions until the next real message arrives, then co-deliver
all accumulated reactions in the same DQ cycle as the real message.
Each reaction MUST NOT be its own separate DQ item.
This is DQ-level coalescing behavior — not just notification suppression.
Implication: the matrix row for "reaction" should show "appears in DQ as batch, not individually."

### P3 — DQ correctness over token optimization (76218)
When there's a conflict between correct DQ behavior and minimizing token use, defer to
correct DQ behavior. Multiple DQ calls consuming multiple messages in sequence is fine.
Fix the obvious cases (agent_event, behavior_nudge) but don't bend DQ semantics to save tokens.

---

## Design intent (voice 76211, 2026-06-20)

The core tension is reliability vs. over-messaging: certain messages MUST come through (reminders, regular messages), while non-actionable notifications should not wake agents. Actionability is the governing filter — if a notification is not one the agent should react to, it should not fire. The complementary concern is that TMCP must emit the right pattern for agents to behave optimally.

## Objective

Write a canonical specification that defines:

1. **Actionability taxonomy** — what constitutes an actionable vs. non-actionable
   TMCP event, and therefore what MUST wake an agent vs. MUST NOT.

2. **Wake contract** — per event category, the normative rule:
   - MUST wake (agent must act)
   - SHOULD wake (agent benefits from acting, but not required)
   - MAY wake (agent may act at discretion)
   - MUST NOT wake (agent waking here is a bug)

3. **Emission contract** — what pattern TMCP should follow when emitting
   notifications so that well-behaved agents can be optimal (correct debounce
   behavior, re-notify timing, etc.).

4. **Edge cases** — reactions, lifecycle events, reminders delivered during
   debounce, multi-session fan-out events.

## Known inputs to inform the spec

### Must-wake (confirmed)
- Operator messages: text, voice, photo, document, command, sticker, etc.
- Reminders (all types: time, startup, last_sent, last_received, schedule)

### Must-not-wake (already suppressed or clearly non-actionable)
- `behavior_nudge_*` (already suppressed via isSilentEvent)
- `agent_event` (lifecycle fan-outs: compacting/compacted — staged fix pending)
- `send_callback` (delivery confirmations — agent doesn't need to wake for these)

### Reactions — specified behavior (voice 76216, 2026-06-20)
- Reactions are aesthetic/emotional signals, not directional or actionable instructions
- Reactions are not confirmation signals
- Preferred pattern: **bundle reactions with the next real message** rather than
  firing a standalone wake; the agent sees both together on the next dequeue
- Implication: reactions should NOT trigger a standalone SSE notify; they should
  be available in the queue but wait for a real message to co-deliver

### Debounce-by-type (voice 76216)
- Different message types may warrant different debounce windows, not just
  binary wake/no-wake
- Spec should consider a per-type or per-category debounce model
- This is a design dimension beyond the current boolean isSilentEvent approach

### Open questions (spec must resolve these)
- **Reactions**: confirmed as non-wake-standalone; spec the bundling/coalescing
  approach. Does TMCP coalesce, or does the agent just drain and see both?
- **`post_compact_monitor_recovery`**: currently NOT suppressed — is this correct?
  (The compacting agent itself needs to re-arm; other sessions should not wake)
- **`service_message` subtypes**: are all service messages non-actionable, or
  only specific event_types?
- **Re-notify timer**: should it include reminder-only queues? (audit finding 5,
  the §5-b gap — but the policy answer belongs in this spec)
- **Channel subscribers vs. SSE**: should the actionability filter apply equally
  to both notification paths, or can channel subscribers have a different policy?

## Deliverable

A spec document at:
`electrified-cortex/Telegram-Bridge-MCP/docs/notification-behavior-contract.md`

### Core artifact: DQ × Notification matrix (voice 76223)

A complete matrix/grid covering **every event type that can appear in the DQ**:

| Event type | Appears in DQ? | Triggers notification/wake? | Rationale |
|---|---|---|---|
| operator message (text/voice/photo/...) | Yes | MUST wake | Actionable |
| reminder | Yes | MUST wake | Actionable — agent must respond |
| reaction | Yes — as BATCH only (coalesced with next real message) | MUST NOT wake | Aesthetic signal, not directive; stale reactions irrelevant; flood-coalesced per P4 |
| behavior_nudge_* | Yes | MUST NOT wake | Internal stats; non-actionable |
| agent_event (compacting/compacted) | Yes | MUST NOT wake | Lifecycle fan-out; non-actionable |
| send_callback | Yes | MUST NOT wake | Delivery confirmation; non-actionable |
| post_compact_monitor_recovery | Yes | MUST wake (own session only) | Agent must re-arm monitors |
| ... (all types from TMCP source) | | | |

Curator must enumerate ALL types from TMCP source (session-queue.ts, event-endpoint.ts)
to fill the matrix completely. Every cell must have a well-defined rationale.

### Document structure
1. Design principles (P1–P4 from voices above)
2. DQ × Notification matrix (full enumeration)
3. Emission contract (debounce policy, re-notify timing, multi-session fan-out)
4. Edge cases (reactions in DQ but no wake; stale reactions; debounce-by-type)
5. Implementation notes: audit findings 1–9 mapped to this spec

## Review process (voice 76219)

Once Curator has a draft spec:
1. **Swarm review** — multi-agent adversarial pass to validate correctness
   (Overseer triggers via `dispatch` or `swarm` skill)
2. **Curator incorporates findings**
3. **Overseer gates final version** before implementation tasks are unblocked

## Acceptance Criteria

1. Wake taxonomy table covers all current event types in TMCP
   (derive from `isSilentEvent` usages + service_message event_type values)
2. Each open question above is answered with a rationale
3. Actionability principle is stated as a first-class rule (not buried)
4. Emission contract specifies debounce policy, re-notify timing, and
   multi-session fan-out behavior
5. Document is self-contained — readable by a new agent joining TMCP work
6. Includes a section mapping back to audit findings 1–9 from epic 10-3020:
   which are safe to implement against this spec, which need further discussion

## Scope boundary

- Spec only — no code changes
- Covers TMCP notification paths only (SSE + channel subscriber)
- Does not redesign TMCP architecture

## Delegation

Executor: Curator / Reviewer: Overseer (then operator for open-question answers)

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-20
- Verdict: PASS — scope bounded (spec only), AC are concrete and enumerated,
  open questions are the work not blockers, blocks 10-3021 through 10-3025
  explicitly. Operator-sourced directly from voice 76211.


---
_Closed 2026-06-26 by task-board audit — shipped/complete (or v6 historical); moved from active lane to 70-done._

**Signed-off-by:** Claude Opus 4.8 — closure verified against `src/` + `git log` on 2026-06-26.
