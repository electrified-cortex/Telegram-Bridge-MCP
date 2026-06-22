# TMCP Notification Behavior Contract

**Status:** Draft v0.2.0 — post-swarm-review revision
**Version:** 0.2.0
**Created:** 2026-06-20
**Swarm review:** 2026-06-20 (2 independent adversarial agents)
**Task:** 10-3020a
**Blocks:** 10-3021, 10-3022, 10-3023, 10-3024, 10-3025, 15-0004
**Operator voices:** 76211, 76216, 76218, 76223, 76226, 76227, 76229

This document is the canonical specification for TMCP notification behavior. It defines which events MUST and MUST NOT wake an agent, how the dequeue (DQ) and notification paths interact, and the emission contract agents should depend on. It is self-contained and intended to be readable by a new agent joining TMCP work.

Source files this spec is derived from:
- `src/session-queue.ts` — session routing, enqueue, isSilentEvent logic
- `src/event-endpoint.ts` — POST /event handler, agent_event fan-out
- `src/service-messages.ts` — all SERVICE_MESSAGES entries and their event types
- `src/reminder-state.ts` — reminder trigger types and fire paths
- `src/message-store.ts` — inbound content type enumeration
- `src/tools/activity/file-state.ts` — NotifySource classification, debounce gate

---

## 1. Design Principles (P1–P5)

These principles are operator-sourced and authoritative. Implementors and reviewers must apply them in order when there is ambiguity.

### P1 — Actionability is the filter (voice 76211)

> "If it's not actionable, I think that's the right thing here. If it's not a notification that the agent should react to, then they shouldn't."

An event is actionable if and only if the agent has a meaningful, non-trivially-deferrable response to it — something it must do now (or very soon) that it cannot recover if it misses. Informational events, delivery confirmations, intra-bridge housekeeping, lifecycle fan-outs, and behavioral hints are all non-actionable.

**Rule:** If a notification does not require an agent to wake and act, it MUST NOT wake. If it does, it MUST wake (or re-notify after debounce expiry).

### P2 — Reactions MUST NOT wake standalone (voices 76216, 76223)

Reactions signal emotion or aesthetic acknowledgment — not direction. A reaction arriving while the agent is parked is irrelevant to the agent's next action. Reactions MUST NOT trigger a standalone SSE notification or activity-file touch.

Reactions DO appear in the DQ. The agent sees them when already running. See P4 for the DQ batching mechanism.

This is a confirmed, non-negotiable decision.

### P3 — DQ correctness over token optimization (voice 76218)

When a design choice pits correct DQ behavior against minimizing token cost, correct DQ behavior wins. Multiple DQ calls consuming multiple messages in sequence is acceptable. Fix obviously broken wake patterns (agent_event, behavior_nudge) but do not bend DQ semantics to save tokens.

### P4 — Reactions are DQ-batched via natural array accumulation (voices 76226, 76227)

The DQ response is already an array. When an agent calls dequeue, it gets all accumulated items together (reactions, service messages, real messages) in one array.

The correct mechanism is:
1. Reactions arrive → NO notification emitted; events accumulate in the queue.
2. Real message (text, voice, command, etc.) arrives → notification emitted; agent wakes.
3. Agent calls dequeue → receives array which MAY include accumulated reactions alongside the real message, IF reactions arrived before the heavyweight delimiter. Reactions arriving AFTER the heavyweight message that triggered the notification will appear in the NEXT dequeue batch (TemporalQueue batches up to and including the first heavyweight delimiter; post-delimiter events carry to the next batch). The notification suppression guarantee (P2) is preserved regardless of ordering — reactions never cause a standalone wake.

This is not complex coalescing logic at the TMCP queue level. It is simply: suppress notification for reactions, allow them to accumulate in the queue, and the DQ array delivers them naturally when the next real message triggers a wake.

**RESOLVED: TemporalQueue uses a single FIFO queue. `enqueueResponse` and `enqueueMessage` are aliases for `enqueue()`. There is no two-lane ordering issue. The only ordering subtlety is the heavyweight delimiter boundary described above.**

### P5 — Reactions are NEVER confirmation signals (voice 76229)

Agents MUST NOT interpret any reaction — including affirmative ones like 👍 or 💯 — as confirmation of intent. Reactions are agreement, flavor, or acknowledgment signals only. This is already established in existing skills/comms specs ("don't take anything as confirmation") and is reinforced here as an invariant.

An agent that blocks on a reaction to confirm an action is operating incorrectly. Intent confirmation requires an explicit operator text/voice/button response.

---

## 2. DQ × Notification Matrix

This table enumerates every event type that can appear in the dequeue response. Every row must have a rationale. "Appears in DQ?" refers to whether the event appears in the array returned by `dequeue`. "Triggers notification/wake?" refers to whether arrival of this event causes TMCP to emit an SSE notification or activity-file touch to wake a parked agent.

### 2.1 Operator message events (`event: "message"`, `from: "user"`)

These events originate from the human operator in the Telegram chat.

| Event type | DQ content type | Appears in DQ? | Triggers notification/wake? | Rationale |
|---|---|---|---|---|
| Operator text message | `text` | Yes | **MUST wake** | Direct operator instruction; agent must read and respond. |
| Operator voice message (transcribed) | `voice` | Yes | **MUST wake** | Operator instruction via audio; agent must read transcription and respond. Phase-2 SSE wake fires after transcription completes (`notifySessionWaiters`). |
| Operator voice message (pending transcription) | `voice` (text undefined) | Yes — queued but not yet released | **MUST NOT wake** (suppressed until transcription completes) | Phase-1 suppression: waking before transcription yields an empty batch. The phase-2 wake fires after `patchVoiceText` completes. |
| Operator command | `command` | Yes | **MUST wake** | Explicit bot command (e.g. `/start`); operator expects immediate action. |
| Operator photo | `photo` | Yes | **MUST wake** | Visual content requiring agent attention. |
| Operator document | `doc` | Yes | **MUST wake** | File requiring agent processing or acknowledgment. |
| Operator video | `video` | Yes | **MUST wake** | Video content requiring agent attention. |
| Operator audio (non-voice) | `audio` | Yes | **MUST wake** | Audio content requiring agent attention. |
| Operator sticker | `sticker` | Yes | **MUST wake** | Sticker messages are operator-directed; agent should acknowledge and interpret. |
| Operator animation (GIF) | `animation` | Yes | **MUST wake** | Animation content is operator-directed input. |
| Operator contact | `contact` | Yes | **MUST wake** | Structured contact data sent by operator; agent may need to process. |
| Operator location | `location` | Yes | **MUST wake** | Geographic data sent by operator; agent may need to process. |
| Unknown message type | `unknown` | Yes | **MUST wake** | Unrecognized Telegram message type; agent should log and acknowledge. |

**Note:** All operator message types in `OPERATOR_MESSAGE_TYPES` (text, voice, command, photo, doc, video, audio, sticker, animation, contact, location, unknown) MUST wake. This set is authoritative in `src/session-queue.ts`.

### 2.2 Reaction events (`event: "reaction"`, `from: "user"`)

| Event type | DQ content type | Appears in DQ? | Triggers notification/wake? | Rationale |
|---|---|---|---|---|
| Operator reaction on any message | `reaction` | Yes — accumulated in queue, delivered in the DQ array when a real message triggers a wake (P4) | **Current behavior (BUG):** Reactions DO trigger notification via `notifySession("operator", ...)` in both `enqueueToSession` and the broadcast fallback loop in `routeToSession`. **Target behavior (P2):** Reactions MUST NOT trigger notification/wake. Fix requires suppression at both call sites (see §5.1 Finding A). | Reactions are flavor/emotion, not direction (P2). They are non-actionable standalone. Stale reactions (from messages the agent already handled) are irrelevant to current state. |

Per P5: the agent MUST NOT treat any reaction (👍, 💯, ❤️, etc.) as confirmation of intent. Reactions are read-only context when the agent is already running.

### 2.3 Callback query events (`event: "callback"`, `from: "user"`)

| Event type | DQ content type | Appears in DQ? | Triggers notification/wake? | Rationale |
|---|---|---|---|---|
| Button press / callback query | `cb` | Yes | **MUST wake** | Operator clicked an inline keyboard button; this is a direct choice/approval action requiring agent response. The agent must call `answer_callback_query` to dismiss the spinner. |

**Note:** Callbacks are `from: "user"` and qualify as operator actions. They are routed to the owning session (the session that sent the message with the button). They are excluded from BOTH `all` AND `operator` modes in `qualifyInbound` (i.e. `return { all: false, operator: false }`) but they ARE actionable — they represent explicit operator choices.

**OPEN QUESTION:** The `qualifyInbound` function excludes `callback` from `last_received` tracking (`if (t === "reaction" || t === "callback") return { all: false, operator: false }`). Is this correct? A button press is arguably as actionable as a text message. This should be reviewed in 10-3021 to determine whether callbacks should update `last_received` for reminder tracking purposes.

### 2.4 User edit events (`event: "user_edit"`, `from: "user"`)

| Event type | Appears in DQ? | Triggers notification/wake? | Rationale |
|---|---|---|---|
| User edited a previously sent message | **No** — silently stored, not enqueued | **MUST NOT wake** | User edits overwrite the store silently per design. The agent already processed the original; a retroactive edit is informational only and not reliably actionable. |

### 2.5 Direct message events (`event: "direct_message"`, `from: "bot"`)

| Event type | DQ content type | Appears in DQ? | Triggers notification/wake? | Rationale |
|---|---|---|---|---|
| Inter-session DM from another agent | `direct_message` | Yes | **MUST wake** | A DM from a peer session is an actionable message requiring the agent's attention. `notifySession` is called with `"operator"` source. DMs qualify for `last_received` `"all"` mode but not `"operator"` mode. |

**Debounce caveat:** DMs use `"operator"` source. A DM arriving during an active operator-message debounce will be suppressed. Because DMs are not in `OPERATOR_MESSAGE_TYPES`, `hasPendingUserContent` will not detect them during re-evaluation — the agent will not receive a re-evaluation notify. The DM will be delivered on next natural dequeue. A parked agent will NOT be re-woken for a suppressed DM.

### 2.6 Send callback events (`event: "send_callback"`, `from: "system"`)

| Event type | DQ content type | Appears in DQ? | Triggers notification/wake? | Rationale |
|---|---|---|---|---|
| Async TTS delivery confirmation (ok/failed/timeout) | `send_callback` | Yes | **MUST NOT wake** | Delivery outcome is a housekeeping confirmation; the agent does not need to take action on a successful delivery. On failure, the agent would typically see this during its active processing loop. The comment in `session-queue.ts` is explicit: "send_callback is bridge-internal housekeeping — no notify". This is excluded from `qualifyInbound` entirely. |

### 2.7 Reminder events (`event: "reminder"`, `from: "system"`)

Reminders have five trigger types, all delivered via `deliverReminderEvent`, which always calls `notifySession` with the `"reminder"` source.

| Reminder trigger type | DQ content type | Appears in DQ? | Triggers notification/wake? | Rationale |
|---|---|---|---|---|
| `time` reminder (fixed delay) | `reminder` | Yes | **MUST wake** | Agent registered this reminder to act at a specific time; the fire is actionable. |
| `startup` reminder | `reminder` | Yes | **MUST wake** | Agent registered instructions to act on session start; must be delivered. |
| `last_sent` reminder | `reminder` | Yes | **MUST wake** | Agent registered a follow-up trigger after a send; the fire is actionable (e.g. "follow up if no reply after N minutes"). |
| `last_received` reminder | `reminder` | Yes | **MUST wake** | Agent registered an inactivity trigger; fire signals the operator has been waiting too long. |
| `schedule` reminder (cron-based) | `reminder` | Yes | **MUST wake** | Agent registered a recurring wall-clock task; fire is actionable. |

**Note:** All reminder types are excluded from `qualifyInbound` (`if (event.event === "reminder") return { all: false, operator: false }`) to prevent reminder fires from updating `last_received` timestamps and creating feedback loops.

### 2.8 Service message events (`event: "service_message"`, `from: "system"` or `"child"`)

Service messages are bridge-injected events. Whether they wake an agent depends on their `event_type` field. The `isSilentEvent` predicate in `session-queue.ts` controls suppression.

#### 2.8.1 Silent service messages (MUST NOT wake — `isSilentEvent = true`)

| `event_type` | Appears in DQ? | Triggers notification/wake? | Rationale |
|---|---|---|---|
| `behavior_nudge_first_message` | Yes | **MUST NOT wake** | Occurs when agent first dequeues a user message; agent is already running. Silent per `isSilentEvent`. |
| `behavior_nudge_slow_gap` | Yes | **MUST NOT wake** | Gap coaching during active session; agent already in loop. Silent per `isSilentEvent`. |
| `behavior_nudge_typing_rate` | Yes | **MUST NOT wake** | Typing-rate coaching during active sends; agent already running. Silent per `isSilentEvent`. |
| `behavior_nudge_question_hint` | Yes | **MUST NOT wake** | First-question hint; fires during active session. Silent per `isSilentEvent`. |
| `behavior_nudge_question_escalation` | Yes | **MUST NOT wake** | Repeated-question escalation; fires during active session. Silent per `isSilentEvent`. |
| `behavior_nudge_presence_rung1` | Yes | **MUST NOT wake** | Presence silence reminder (rung 1); fires during active session. Silent per `isSilentEvent`. |
| `behavior_nudge_presence_rung2` | Yes | **MUST NOT wake** | Presence silence reminder (rung 2); fires during active session. Silent per `isSilentEvent`. |
| `behavior_nudge_caption_duplication` | Yes | **MUST NOT wake** | Caption coaching; fires during active session. Silent per `isSilentEvent`. |
| `behavior_nudge_reaction_semantics` | Yes | **MUST NOT wake** | Reaction semantic coaching; agent already running. Silent per `isSilentEvent` (`startsWith("behavior_nudge")`). |
| `modality_hint_voice_received` | Yes | **MUST NOT wake** | Voice modality hint; fires when voice is dequeued (agent already running). `eventType` starts with `modality_hint_` not `behavior_nudge_` — **OPEN QUESTION:** is this event currently suppressed? The `isSilentEvent` check is `startsWith("behavior_nudge")` only. This may be a gap. See Section 5. |
| `agent_event` | Yes | **MUST NOT wake** | Lifecycle fan-out (`compacting`, `compacted`, `startup`, `shutdown_warn`, `shutdown_complete`) delivered to ALL sessions. Receiving sessions need this for awareness only; they should not wake. Silent per `isSilentEvent`. |

**Current `isSilentEvent` predicate (from `session-queue.ts`):**
```
const isSilentEvent =
  event.content.event_type?.startsWith("behavior_nudge") ||
  event.content.event_type === "agent_event";
```

#### 2.8.2 Non-silent service messages (wake depends on context)

| `event_type` | Appears in DQ? | Triggers notification/wake? | Rationale |
|---|---|---|---|
| `post_compact_monitor_recovery` | Yes | **MUST wake (own session only)** | Delivered exclusively to the compacting agent's own session (`resolvedActorSid`). The agent must re-arm its monitors after compaction. Not delivered to other sessions. This is NOT suppressed (correctly). |
| `shutdown` | Yes | **MUST wake** | Server shutdown warning; agent must begin graceful teardown. **Note:** `shutdown` is not in the `VALID_KINDS` set used by the POST /event endpoint (`event-endpoint.ts`). Origin code path not identified in reviewed source. Treat as unverified until source is located. |
| `voice_transcription_failed` | Yes | **MUST wake** | Voice message could not be transcribed; agent must inform operator or request resend. |
| `persistent_animation_running` | Yes | **MUST wake** | An animation was running during compaction/restart; agent must decide whether to continue or cancel. Comment in source confirms this is "intentionally NOT suppressed". |
| `governor_changed` | Yes | **MUST wake** | Routing topology changed; all sessions need awareness. Agent should read new governor. |
| `governor_promoted` | Yes | **MUST wake** | This session is now governor; agent must take on routing responsibilities. |
| `session_joined` | Yes | **MUST wake** | A new session joined; governor must be aware of routing implications. **Note:** Two distinct service message specs (`SESSION_JOINED` and `SESSION_JOINED_FELLOW`) share the same `event_type: 'session_joined'`. Agents MUST NOT rely on `event_type` alone to distinguish them — check message content/details fields. |
| `session_closed` | Yes | **MUST wake** | A peer session closed; governor must handle routing changes. |
| `session_closed_new_governor` | Yes | **MUST wake** | Combined close+governor-change; requires routing awareness update. |
| `child_first_dequeue_confirmed` | Yes | **MUST wake** | Parent learns its sub-agent is live; may trigger follow-up dispatch work. |
| `child_session_resolved` | Yes | **MUST wake** | Sub-agent has exited; parent must read exit status and determine next action. |
| `duplicate_session_detected` | Yes | **MUST wake** | Security alert: two callers sharing one session identity. Requires immediate investigation. |
| `onboarding_token_save` | Yes | **SHOULD wake** (fires once on session start, during initial dequeue) | Onboarding instruction; agent is typically not yet parked (just started). Fires at session_start → first dequeue. |
| `onboarding_loop_pattern` | Yes | **SHOULD wake** | Monitor setup instructions; needed for agent to arm its loop. Fires at session_start. |
| `onboarding_compaction_hint` | Yes | **SHOULD wake** | Compaction recovery guidance; needed for agent resilience. Fires at session_start. |
| `onboarding_role` | Yes | **SHOULD wake** | Governor role assignment; agent needs this to route correctly. |
| `onboarding_protocol` | Yes | **SHOULD wake** | Etiquette instructions on first session. |
| `onboarding_buttons` | Yes | **SHOULD wake** | Button usage guidance on first session. |
| `onboarding_hybrid_messaging` | Yes | **SHOULD wake** | Audio+text hybrid guidance. |
| `onboarding_modality_priority` | Yes | **SHOULD wake** | Modality preference guidance. |
| `onboarding_presence_signals` | Yes | **SHOULD wake** | Presence signal ordering guidance. |
| `onboarding_no_pending_yet` | Yes | **SHOULD wake** | Tells agent to call dequeue for first message. |
| `onboarding_participating` | Yes | **SHOULD wake** | Confirms SSE monitor armed; agent can begin its loop. |
| `onboarding_arm_reminder` | Yes | **MUST wake** | Agent has not armed monitor 45s after listen subscription; must act to participate. |
| `post_compact_sse_recovery` | Yes | **MUST wake (own session only)** | SSE URL expired after compaction; agent must re-arm to continue participating. |
| `spawn_child_subagent_hint` | Yes | **MUST wake** | Agent must dispatch a sub-agent to drain the child's queue. |
| `compression_hint_first_dm` | Yes | **SHOULD wake** | First DM compression guidance; fires during active DM session. |
| `compression_hint_first_route` | Yes | **SHOULD wake** | First route compression guidance; fires during active routing session. |
| `activity_file_monitor_instructions` | Yes | **MUST wake** | Concrete monitor arming instructions; agent must act to participate. |
| `onboarding_child_token` | Yes | **SHOULD wake** | Child session token reminder on first dequeue. |
| `onboarding_child_role` | Yes | **SHOULD wake** | Child role/context briefing on first dequeue. |
| `onboarding_child_loop` | Yes | **SHOULD wake** | Child dequeue loop instructions. |
| `onboarding_child_exit_protocol` | Yes | **SHOULD wake** | Child exit protocol instructions. |

**OPEN QUESTION:** All onboarding events and most lifecycle events currently flow through the same `deliverServiceMessage` path, which calls `notifySession` with `"service"` source when `!isSilentEvent`. The `"service"` source in the notify gate (`file-state.ts`) has special behavior: it does NOT notify if `inflightAtEnqueue` is true (agent is in dequeue), but DOES notify if the agent is parked. This means onboarding events DO wake parked agents — which is correct. However, it also means all non-silent service messages share the same debounce window with operator messages. Is per-type debounce warranted? See Section 4.4.

#### 2.8.3 Child-notify service messages (`event: "service_message"`, `from: "child"`)

| Event type | Appears in DQ? | Triggers notification/wake? | Rationale |
|---|---|---|---|
| `child/notify` events (any `event_type` set by child) | Yes | **MUST wake** | Parent receives structured notification from sub-agent. `deliverChildNotifyEvent` calls `notifySession` with `"service"` source. These are actionable inter-agent signals. |

### 2.9 Summary: NotifySource classification

The gate in `src/tools/activity/file-state.ts` classifies events by source:

| `NotifySource` | Wakes parked agent? | Wakes in-flight agent? | Used by |
|---|---|---|---|
| `"operator"` | Yes | Yes (suppressed by debounce if already notified) | Operator messages, callbacks, DMs, routed messages, phase-2 voice wake |
| `"reminder"` | Yes | Yes | All reminder fires |
| `"approval-self"` | Yes | Yes | Self-approval workflows |
| `"approval-governor"` | Yes | Yes | Governor approval workflows |
| `"service"` | Yes | **No** (suppressed when `inflightDequeue`) | Non-silent service messages |
| `"bridge-internal"` | **No** | **No** | send_callback (currently hardcoded no-notify in `deliverAsyncSendCallback`) |

**Note:** A second in-flight guard in `notifyIfAllowed` (checks `entry.inflightDequeue` at gate time) suppresses ALL sources including `"operator"` and `"reminder"` when the agent is actively in a dequeue call. The `classify()` function only determines which sources are pre-filtered before reaching the gate. This applies to both the `"operator"` and `"reminder"` rows above.

---

## 3. Emission Contract

### 3.1 Debounce policy

TMCP applies a post-notify debounce to prevent notification storms. The gate is per-session and shared across SSE and activity-file channels.

- **Default debounce window:** 300,000 ms (5 minutes) — `NOTIFY_DEBOUNCE_MS` in `file-state.ts`.
- **Configurable range:** 1,000 ms minimum, 3,600,000 ms maximum.
- **Behavior:** After a notify fires, subsequent notifications within the debounce window set `notifyPendingBecauseDebounce = true` but do NOT touch the file or emit SSE.
- **Debounce release:** When the agent returns from dequeue with content, `releaseNotifyDebounce()` is called. If `notifyPendingBecauseDebounce` is true AND the queue still has pending user content, a re-evaluation notify fires immediately.
- **Stale debounce:** If the debounce window expires before the agent dequeues, the next inbound event fires a fresh notify (no missed-wake risk for wedged agents beyond one debounce window).
- **Timeout-only exits:** Dequeue calls that return only due to timeout (no content) do NOT release the debounce.

**Re-evaluation scope limitation:** The re-evaluation notify uses `hasPendingUserContent()`, which checks ONLY `OPERATOR_MESSAGE_TYPES` (text, voice, command, photo, doc, video, audio, sticker, animation, contact, location, unknown). The following event types suppressed during debounce will NOT trigger re-evaluation:
- Callbacks (button presses) — silently waiting in queue
- Direct messages (DMs from peer agents)
- Reminders

These events accumulate in the queue and will be delivered on the agent's next natural dequeue. However, a parked agent may remain parked indefinitely if the only pending item is a DM or callback (no re-evaluation notify fires). This is a known gap — see open question in §3.2.

### 3.2 Re-notify timing

Re-notify fires in three conditions:
1. **Debounce release path:** Immediately after agent returns from a content-returning dequeue, if a notification was suppressed during the prior debounce window and queue still has pending user content.
2. **Stale debounce path:** Next inbound event after `notifyDebounceUntil` has elapsed fires a fresh notify unconditionally.
3. **Proactive timer path:** After a notify fires, a `pendingReNotifyHandle` timer is set for `debounceMs` (default 5 minutes). When it fires, if `hasPendingUserContent(sid)` is true, a re-evaluation notify fires proactively — without waiting for a new inbound event or debounce release. This ensures an agent that parks and never returns from dequeue still receives a wake within one debounce window if operator message content is still pending.

**OPEN QUESTION:** The `"reminder"` source and `"service"` source are both subject to the same shared debounce gate. This means a reminder fire during an active operator conversation may be suppressed by the debounce from the operator message notify. Is this acceptable? The operator voice (76218) says "reminders must come through." If reminders are suppressed by the operator-message debounce, they will be delivered in the DQ array on the next dequeue (the agent is already running) — but a parked agent after a long conversation may miss a reminder fire if it arrives before the debounce clears. This should be evaluated in 10-3021.

**Known gap:** A parked agent may remain parked indefinitely if the only pending item in the queue is a DM or callback, because `hasPendingUserContent()` does not detect these types and therefore neither the proactive re-notify timer (condition 3 above) nor the debounce re-evaluation path (condition 1 above) will fire. The DM or callback will only be delivered on the agent's next natural dequeue or when the next operator message arrives.

### 3.3 Multi-session fan-out

Events arriving at the bridge are routed to sessions as follows:

| Routing mode | Behavior | Notifies |
|---|---|---|
| Targeted (reply-to, reaction, callback) | Delivered to owning session only | Owner session only |
| Ambiguous (no reply context) | Delivered to governor session if set | Governor session only |
| Broadcast (no governor, or forced) | Delivered to ALL sessions | All sessions; self-notify suppressed via `AC-1` filter |
| Outbound governor copy | Governor receives all outbound events via `broadcastOutbound` | Governor queue only (no notify, no SSE) |

**AC-1 self-notify filter:** When an event originates from a session (e.g. a bot reaction to its own message), that session is NOT notified. This prevents agents from waking themselves on their own sends. Implemented via `originatorSid` parameter in `notifySession`.

**`agent_event` fan-out (POST /event):** When the `/event` endpoint receives `compacting`, `compacted`, `startup`, `shutdown_warn`, or `shutdown_complete`, it fans out an `agent_event` service message to ALL sessions. These are silently enqueued (no wake). The `stopped` kind is suppressed from fan-out entirely (high-frequency noise).

**`last_received` asymmetry:** `notifyLastReceived` is called only for TARGETED routing (message with recognized owner). Governor-routed (ambiguous) and broadcast-routed messages do NOT update `last_received`. Only messages targeted to a specific session count as "received by that session" for reminder tracking purposes.

**`broadcastOutbound` channel exception:** `broadcastOutbound` also omits `notifyChannelSubscriber` — outbound governor copies do NOT appear in channel subscriber feeds. This is an exception to the "channel = raw feed" principle from §3.4.

### 3.4 Channel subscriber vs. SSE notification

Two notification paths exist:
1. **SSE / activity file (`notifySession`):** Subject to the full debounce gate. Only fires for `NotifySource` values that pass the gate.
2. **Channel subscriber (`notifyChannelSubscriber`):** Called for ALL events, bypassing the debounce gate. Channel consumers receive every event immediately.

**OPEN QUESTION:** Should the actionability filter from this spec apply to the channel subscriber path? Currently the channel receives all events (including silent service messages and reactions) without filtering. If a channel subscriber is an agent or automation that should respect the same wake semantics, it will receive more events than the SSE path. This may be intentional (channel = raw feed) or a gap. Needs explicit policy decision.

---

## 4. Edge Cases

### 4.1 Reactions in DQ without wake

When a reaction arrives while an agent is parked:
1. `routeToSession` → `enqueueToSession` → `q.enqueue(event)` — reaction is queued.
2. `notifySession` IS called with `"operator"` source — but see below.

**OPEN QUESTION (implementation gap):** The current code in `enqueueToSession` calls `notifySession(sid, "operator", ...)` for ALL events, including reactions. This means reactions currently DO emit a notification. The `isSilentEvent` predicate is only checked in `deliverServiceMessage`, not in `enqueueToSession`. To implement P2 correctly, `enqueueToSession` must suppress notification for `event.event === "reaction"` events. This is an audit finding requiring a code fix (see Section 5, Finding A).

After the fix: reactions arrive → queue → no notify → agent stays parked → real message arrives → notify → agent wakes → `dequeue()` → receives array containing both accumulated reactions and the real message.

**Note:** After the P2 fix, reactions will never emit notifications and therefore cannot affect the debounce state. A flood of reactions between two real messages will not trigger the debounce — only real messages do. The debounce window is entirely reaction-transparent.

### 4.2 Stale reactions

A reaction to a message from 5 turns ago is semantically irrelevant to the current conversation state. However, TMCP has no concept of "staleness" at the queue level — all reactions are enqueued regardless of how old the target message is.

**Policy:** Agents MUST NOT act on reactions as if they were current instructions, regardless of when they appear in the DQ array. Agents should consume reactions as context-only signals about past messages (per P2 and P5).

**OPEN QUESTION:** Should TMCP implement a staleness filter at enqueue time (e.g. drop reactions to messages older than N turns or older than X minutes)? Or is this left to agent interpretation? Operator preference (voice 76216) suggests the batching behavior (P4) is the primary solution — agents will see reactions alongside the next real message, which provides natural context.

### 4.3 Debounce-by-type

The current debounce gate is binary: one shared window per session, applied after ANY qualifying notification fires. The operator noted (voice 76216) that different message types may warrant different debounce windows.

**Example tension:** An operator sends a text message (notifies, starts 5-minute debounce). The agent processes it and parks. 30 seconds later, a `post_compact_monitor_recovery` service message arrives. It is suppressed by the debounce. The agent will see it on next dequeue, but if the agent is parked for the rest of the debounce window, the monitor recovery message has no mechanism to force a wake.

**Current mitigation:** `post_compact_monitor_recovery` is the compacting agent's own event — it fires immediately after the `/event` `compacted` call, typically while the agent is still in the middle of its processing loop. In practice it arrives during active dequeue, not when parked. But this is a timing assumption, not a guarantee.

**OPEN QUESTION:** Should `"reminder"` and `"service"` sources have independent debounce windows from `"operator"` sources? This would require splitting the shared gate state into per-source lanes. Given P3 (DQ correctness over token optimization), a parked agent that misses a reminder fire due to a prior operator-message debounce is a correctness issue, not just a token issue. This warrants a design decision before 10-3021 implementation.

### 4.4 `modality_hint_voice_received` suppression gap

The `isSilentEvent` predicate in `deliverServiceMessage` checks:
- `event.content.event_type?.startsWith("behavior_nudge")`
- `event.content.event_type === "agent_event"`

The `modality_hint_voice_received` event type starts with `modality_hint_`, NOT `behavior_nudge_`. It is therefore NOT currently suppressed by `isSilentEvent`. This event fires when a voice message is dequeued (agent already running) — so in practice it arrives during active dequeue and the agent reads it inline. But if for any reason it arrives when the agent is parked, it would currently emit a notification.

**Resolution options:**
1. Change the prefix to `behavior_nudge_voice_modality` for consistency.
2. Add `modality_hint_` as a second startsWith check in `isSilentEvent`.
3. Accept current behavior (notify if parked, silent if in-flight) as correct — a voice modality hint is arguably actionable if the agent is parked.

**OPEN QUESTION:** Which resolution is correct? Tagging for swarm review.

### 4.5 `stopped` event suppression

The `/event` endpoint suppresses fan-out for `kind: "stopped"` events: "high-frequency noise, no actionable signal." This means when an agent session reports it has stopped (e.g. via a Stop hook), no other session is notified. Only the session-stopped side-effect (`handleSessionStopped`) runs.

**Policy confirmed:** `stopped` MUST NOT fan-out. High-frequency lifecycle noise.

### 4.6 Compaction events: fan-out vs. own-session distinction

When an agent sends `kind: "compacted"` to POST /event:
1. ALL sessions receive an `agent_event` service message (silent — MUST NOT wake).
2. The compacting session ITSELF receives a `post_compact_monitor_recovery` message (MUST wake own session).

This two-tier design is correct and intentional:
- Other sessions need awareness (`agent_event`) but do not need to act.
- The compacting session needs to re-arm monitors (`post_compact_monitor_recovery`).

The `agent_event` is correctly silenced. The `post_compact_monitor_recovery` is correctly NOT silenced.

---

## 5. Implementation Notes

### 5.1 Mapping to audit findings (epic 10-3020)

The following maps known audit findings to this spec. Items marked "safe to implement" may proceed against this spec without further design discussion. Items marked "needs review" require open questions to be resolved first.

| Finding | Description | This spec says | Safe to implement? |
|---|---|---|---|
| **Finding A** | Reactions currently emit notifications (bug) | P2: reactions MUST NOT wake. Fix requires suppression at TWO call sites: (1) `enqueueToSession` (primary path — suppress `notifySession` for `event.event === "reaction"`); (2) the broadcast fallback loop in `routeToSession` (lines 280-290 of `session-queue.ts`) where `notifySession` is called directly for each session in a `for` loop — this path must ALSO skip the notify for reactions. **Additionally: Finding I (TemporalQueue audit) must be resolved before Finding A ships.** | **NEEDS FIX SCOPE EXPANSION** — P2 is confirmed, but fix requires two call sites (see above). Do not close until both are patched and Finding I is resolved. |
| **Finding B** | `agent_event` fan-out currently wakes agents | `agent_event` is correctly listed as `isSilentEvent`. If agents are waking on it, the bug is elsewhere (e.g. global queue path). | Yes — silence is confirmed correct. Investigate if wakes are observed. |
| **Finding C** | `behavior_nudge_*` events currently wake agents | Same as Finding B — `isSilentEvent` covers all `behavior_nudge_` prefixes. | Yes — silence is confirmed correct. |
| **Finding D** | `send_callback` events: no notify path | Confirmed: `deliverAsyncSendCallback` already does not call `notifySession`. Correct per spec. | N/A — already correct. |
| **Finding E** | `modality_hint_voice_received` not suppressed | OPEN QUESTION in Section 4.4. Not safe to implement without resolution. | **Needs review.** |
| **Finding F** | Debounce suppresses reminders during active conversation | OPEN QUESTION in Section 3.2. Policy not yet decided. | **Needs review.** |
| **Finding G** | Callback qualifying for `last_received` | OPEN QUESTION in Section 2.3. | **Needs review.** |
| **Finding H** | Channel subscriber receives all events without filter | OPEN QUESTION in Section 3.4. | **Needs review.** |
| **Finding I** | TemporalQueue reaction batching behavior | RESOLVED: TemporalQueue uses a single FIFO queue. `enqueueResponse` and `enqueueMessage` are aliases for `enqueue()`. There is no two-lane ordering issue. The only ordering subtlety is the heavyweight delimiter boundary described in P4. **Must be confirmed clear before Finding A ships.** | **Resolved — confirm before Finding A ships.** |

### 5.2 Open questions consolidated

For swarm review, the open questions from this document are enumerated here:

1. **P4 / Section 4.1 (Finding I):** RESOLVED — TemporalQueue uses a single FIFO queue; no two-lane ordering issue. See Finding I row above and P4 resolution note.

2. **Section 2.3 / Finding G:** Should `callback` (button press) update `last_received` timestamps for reminder tracking? Currently excluded from both `all` and `operator` modes in `qualifyInbound`.

3. **Section 3.2 / Finding F:** Can a reminder fire be suppressed by the debounce from a prior operator-message notify, leaving a parked agent un-woken? If yes, is this acceptable given P1 ("reminders must come through")?

4. **Section 3.4 / Finding H:** Should the actionability filter apply to the channel subscriber path, or is channel always a raw unfiltered feed?

5. **Section 4.4 / Finding E:** Is `modality_hint_voice_received` intentionally non-silent, or should it be added to the `isSilentEvent` predicate?

6. **Section 4.1 (Finding A — implementation):** Confirm that suppressing `notifySession` for reactions in both `enqueueToSession` AND the broadcast fallback loop in `routeToSession` does not break the AC-1 self-notify filter or any other path that depends on those call sites.

7. **Section 3.1 / §3.2 (DM/callback re-evaluation gap):** A parked agent may remain parked indefinitely if the only pending item is a DM or callback, since `hasPendingUserContent()` does not detect these types. Policy decision needed: is this gap acceptable, or should DMs and callbacks be added to the re-evaluation check?

### 5.3 Wake taxonomy summary (agent-readable)

For an agent consuming TMCP events, the rule is:

**Wake on (MUST act):**
- Any `event: "message"` from operator (text, voice, command, photo, doc, video, audio, sticker, animation, contact, location, unknown)
- Any `event: "callback"` (button press)
- Any `event: "direct_message"` (inter-agent DM)
- Any `event: "reminder"` (all trigger types)
- Service messages: `post_compact_monitor_recovery`, `post_compact_sse_recovery`, `shutdown`, `voice_transcription_failed`, `persistent_animation_running`, `governor_*`, `session_*`, `child_*`, `spawn_child_subagent_hint`, `onboarding_arm_reminder`, `activity_file_monitor_instructions`, `duplicate_session_detected`
- All `onboarding_*` and `compression_hint_*` service messages — see §2.8.2 for full enumeration. Specific types: `onboarding_token_save`, `onboarding_loop_pattern`, `onboarding_compaction_hint`, `onboarding_role`, `onboarding_protocol`, `onboarding_buttons`, `onboarding_hybrid_messaging`, `onboarding_modality_priority`, `onboarding_presence_signals`, `onboarding_no_pending_yet`, `onboarding_participating`, `onboarding_child_token`, `onboarding_child_role`, `onboarding_child_loop`, `onboarding_child_exit_protocol`, `compression_hint_first_dm`, `compression_hint_first_route`

**Do NOT act on (read as context only):**
- Any `event: "reaction"` — read for context; NEVER as confirmation or instruction.
- Any `event: "send_callback"` — delivery housekeeping; no agent response needed.
- Service messages with `event_type` matching `behavior_nudge_*` or `agent_event` — informational; read during active loop.
- `event: "user_edit"` — never appears in DQ (not enqueued).

**MUST NOT treat as confirmation:**
- Reactions of any emoji (P5) — not 👍, not 💯, not ❤️. Confirmation requires explicit operator text, voice, or button response.
