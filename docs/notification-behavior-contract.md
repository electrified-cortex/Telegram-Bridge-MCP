# TMCP Notification Behavior Contract

**Status:** v1.0 — descriptive (reverse-engineered from implementation)
**Derived from:** `src/session-queue.ts`, `src/tools/activity/file-state.ts`, `src/reminder-state.ts`, `src/event-endpoint.ts`, `src/service-messages.ts`
**Updated:** 2026-06-27

This document canonicalizes current TMCP notification behavior as implemented. It does not prescribe changes. Gaps are flagged explicitly; fix decisions belong to Overseer.

---

## 1. Design Principles

Five operator-confirmed invariants govern all notification decisions. Listed in priority order.

### P1 — Actionability is the filter

An event is actionable if and only if the agent has a non-trivially-deferrable response to it — something it must do now that it cannot recover if it misses. Informational events, delivery confirmations, lifecycle fan-outs, and behavioral hints are non-actionable.

**Rule:** If a notification does not require an agent to wake and act, it MUST NOT wake. If it does, it MUST wake (or re-notify after debounce expiry).

### P2 — Reactions MUST NOT wake

Reactions signal emotion or aesthetic acknowledgment — not direction. A reaction arriving while the agent is parked is non-actionable. Reactions MUST NOT trigger an SSE notification or activity-file touch.

Reactions DO appear in the DQ. The agent sees them when already running. See P4.

This is a confirmed, non-negotiable decision.

### P3 — DQ correctness over token optimization

When a design choice pits correct DQ behavior against minimizing token cost, correct DQ behavior wins. Multiple DQ calls consuming multiple messages is acceptable. Fix broken wake patterns; do not bend DQ semantics to save tokens.

### P4 — Reactions DQ-batch via natural accumulation

Reactions arrive with no SSE notification. They accumulate in the TemporalQueue. When the next real message (text, voice, command, etc.) arrives and triggers a wake, the agent dequeues an array that MAY include those accumulated reactions alongside the real message — if the reactions arrived before the heavyweight delimiter. Reactions after the delimiter carry to the next batch.

**Current state:** Co-delivery in the same batch works correctly. Each reaction remains a separate DQ item rather than being merged. True reaction coalescing is not implemented — see Gap 2.

### P5 — Reactions are NEVER confirmation signals

Agents MUST NOT interpret any reaction — including 👍 or 💯 — as confirmation of intent. Confirmation requires an explicit operator text, voice, or button response. This is a behavioral invariant; it is not currently code-enforced.

---

## 2. DQ × Notification Matrix

Columns: "In DQ?" = item appears in `dequeue()` array. "SSE/file wakes?" = `notifySession` / activity-file path fires. "Channel subscriber notified?" = `notifyChannelSubscriber` called.

### 2.1 Summary table

| Event type | In DQ? | SSE/file wakes? | Channel subscriber notified? |
|---|---|---|---|
| `message` — text, voice, photo, doc, video, audio, sticker, animation, contact, location, unknown, command | Yes | YES | YES |
| `message` — callback (button press) | Yes | YES | YES |
| `reaction` | Yes, individually | NO | YES ⚠️ — see Gap 1 |
| `reminder` (all trigger types: time, startup, last_sent, last_received, schedule) | Yes | YES | YES |
| `direct_message` (inter-session DM) | Yes | YES | YES |
| `send_callback` (async TTS result) | Yes | NO | NO |
| `service_message` / `behavior_nudge_*` | Yes | NO — `isSilentEvent` | NO |
| `service_message` / `agent_event` (compacting, compacted, startup, shutdown_warn, shutdown_complete) | Yes | NO — `isSilentEvent` | NO |
| `service_message` / `post_compact_monitor_recovery` | Yes | YES — actor session only | YES |
| `service_message` / all other subtypes (onboarding_*, session_joined, session_closed, child notifications, etc.) | Yes | YES | YES |
| `message` — voice (phase-1, transcription pending) | Yes | NO — phase-1 suppression | YES — channel always called |
| `user_edit` | **No** — stored silently, not enqueued | **Never** | **Never** |

### 2.2 Wake predicates (source code)

The SSE/file notification path is gated by `isNotifyTriggerEvent` in `session-queue.ts`:

```typescript
function isNotifyTriggerEvent(event: TimelineEvent): boolean {
  return event.event !== "reaction";
}
```

`isSilentEvent` additionally gates service messages:

```typescript
const isSilentEvent =
  event.content.event_type?.startsWith("behavior_nudge") ||
  event.content.event_type === "agent_event";
```

Both predicates must pass for an event to generate an SSE wake or activity-file touch. The channel subscriber path (`notifyChannelSubscriber`) is NOT gated by either predicate — see Gap 1.

### 2.3 Operator message events (`event: "message"`, `from: "user"`)

All types in `OPERATOR_MESSAGE_TYPES` MUST wake. This set is authoritative in `session-queue.ts`.

| Content type | Wakes? | Notes |
|---|---|---|
| `text` | YES | Direct operator instruction |
| `voice` | YES (phase-2 only) | Phase-1 suppressed pending transcription; phase-2 fires after `patchVoiceText` |
| `command` | YES | Explicit bot command (e.g. `/start`) |
| `photo` | YES | Visual content |
| `doc` | YES | File requiring processing |
| `video` | YES | Video content |
| `audio` | YES | Audio (non-voice) content |
| `sticker` | YES | Operator-directed; agent should acknowledge |
| `animation` | YES | GIF; operator-directed input |
| `contact` | YES | Structured contact data |
| `location` | YES | Geographic data |
| `unknown` | YES | Unrecognized type; agent should log |

### 2.4 Reaction events (`event: "reaction"`, `from: "user"`)

| Aspect | Current behavior |
|---|---|
| In DQ? | Yes — accumulated individually; delivered in array when next real message triggers wake |
| SSE/file wakes? | NO — `isNotifyTriggerEvent` returns `false` |
| Channel notified? | YES — `notifyChannelSubscriber` called unconditionally (Gap 1) |
| `last_received` updated? | No — excluded in `qualifyInbound` alongside callbacks |

Per P5: agents MUST NOT treat any reaction as confirmation of intent.

### 2.5 Callback query events (`event: "callback"`, `from: "user"`)

Button presses are operator-directed choices. The agent must call `answer_callback_query` to dismiss the loading spinner.

| Aspect | Current behavior |
|---|---|
| In DQ? | Yes |
| SSE/file wakes? | YES — `isNotifyTriggerEvent` passes (callback is not a reaction) |
| Channel notified? | YES |
| `last_received` updated? | No — excluded in `qualifyInbound` alongside reactions |

### 2.6 Direct message events (`event: "direct_message"`, `from: "bot"`)

Inter-session DMs from peer agents.

| Aspect | Current behavior |
|---|---|
| In DQ? | Yes |
| SSE/file wakes? | YES — `notifySession` called with `"operator"` source |
| Channel notified? | YES |
| `last_received` updated? | `all` mode only — not `operator` mode |

**Debounce caveat:** DMs use the `"operator"` source. A DM arriving during an active operator-message debounce will be suppressed. `hasPendingUserContent` does not detect DMs, so neither the proactive re-notify timer nor the debounce release path will fire for a suppressed DM. The DM is delivered on next natural dequeue; a parked agent will not be re-woken.

### 2.7 Reminder events (`event: "reminder"`, `from: "system"`)

All trigger types are delivered via `deliverReminderEvent`, which always calls `notifySession` with the `"reminder"` source.

| Trigger type | Wakes? | Notes |
|---|---|---|
| `time` | YES | Fixed-delay registered by agent |
| `startup` | YES | Instructions to act on session start |
| `last_sent` | YES | Follow-up trigger after a send |
| `last_received` | YES | Operator-inactivity trigger |
| `schedule` | YES | Cron-based recurring task |

All reminder types are excluded from `qualifyInbound` to prevent reminder fires from updating `last_received` timestamps and creating feedback loops.

### 2.8 Service message events (`event: "service_message"`)

#### 2.8.1 Silent service messages (`isSilentEvent = true`)

| `event_type` | Wakes? | Rationale |
|---|---|---|
| `behavior_nudge_*` (all variants) | NO | Coaching messages; agent already running when these fire |
| `agent_event` (compacting, compacted, startup, shutdown_warn, shutdown_complete) | NO | Lifecycle fan-out to all sessions; receiving sessions need awareness, not action |

#### 2.8.2 Non-silent service messages

| `event_type` | Wakes? | Scope | Rationale |
|---|---|---|---|
| `post_compact_monitor_recovery` | YES | Actor session only | Agent must re-arm monitors post-compaction |
| `post_compact_sse_recovery` | YES | Own session only | SSE URL expired; agent must re-arm |
| `voice_transcription_failed` | YES | Targeted session | Agent must inform operator or request resend |
| `persistent_animation_running` | YES | Targeted session | Agent must decide to continue or cancel |
| `duplicate_session_detected` | YES | Targeted session | Security alert; requires immediate investigation |
| `governor_changed` | YES | All sessions | Routing topology changed; agents need awareness |
| `governor_promoted` | YES | Targeted session | This session is now governor; must take routing responsibilities |
| `session_joined` | YES | All / governor | Routing implications for multi-session topology |
| `session_closed` | YES | All / governor | Governor must handle routing changes |
| `session_closed_new_governor` | YES | All / governor | Combined close+governor-change |
| `child_first_dequeue_confirmed` | YES | Parent session | Sub-agent is live; may trigger follow-up dispatch |
| `child_session_resolved` | YES | Parent session | Sub-agent exited; parent reads exit status |
| `spawn_child_subagent_hint` | YES | Parent session | Must dispatch sub-agent immediately |
| `activity_file_monitor_instructions` | YES | Own session | Concrete monitor arming instructions |
| `onboarding_arm_reminder` | YES | Own session | Agent has not armed monitor 45s after subscribe |
| `onboarding_*` (all variants) | YES | Own session | Setup instructions at session start; agent may be parked on first fire |
| `compression_hint_*` | YES | Own session | Guidance during active DM/routing sessions |

### 2.9 NotifySource classification

The gate in `src/tools/activity/file-state.ts` classifies events by source:

| `NotifySource` | Wakes parked agent? | Wakes in-flight agent? | Used by |
|---|---|---|---|
| `"operator"` | Yes | Yes (debounce may suppress) | Operator messages, callbacks, DMs, routed messages, phase-2 voice wake |
| `"reminder"` | Yes | Yes | All reminder fires |
| `"service"` | Yes | **No** — suppressed when `inflightDequeue` | Non-silent service messages |
| `"bridge-internal"` | **No** | **No** | `send_callback` — explicitly no-notify in `deliverAsyncSendCallback` |

A second in-flight guard in `notifyIfAllowed` checks `entry.inflightDequeue` at gate time and suppresses ALL sources when the agent is actively executing a dequeue call. Source classification pre-filters before this gate.

---

## 3. Emission Contract

### 3.1 Debounce policy

TMCP applies a per-session post-notify debounce to prevent notification storms. The gate is shared across SSE and activity-file channels.

| Agent state | Debounce window |
|---|---|
| Agent active (in dequeue) | 60 seconds post-notify |
| Agent parked / idle | 300 seconds post-notify |

After a notify fires, subsequent notifications within the window set an internal pending flag but do NOT touch the activity file or emit SSE. The debounce is shared across all `NotifySource` values — no per-source lane.

### 3.2 Re-notify timing

Re-notify fires in three conditions:

1. **Debounce release path:** Agent returns from a content-returning dequeue. If a notification was suppressed during the prior window AND `hasPendingUserContent(sid) || hasPendingReminderContent(sid)` is true, re-notify fires immediately.

2. **Stale debounce path:** Next inbound event after the window has elapsed fires a fresh notify unconditionally. No missed-wake risk beyond one debounce window for wedged agents.

3. **Proactive timer path:** After a notify fires, a `pendingReNotifyHandle` timer is set for `debounceMs`. When it fires, if `hasPendingUserContent(sid) || hasPendingReminderContent(sid)` is true, a re-evaluation notify fires proactively — without waiting for a new inbound event or debounce release.

Reminder-only queues ARE included in re-notify evaluation (`hasPendingReminderContent`). Dequeue calls that return only due to timeout (no content) do NOT release the debounce.

**Known limitation:** Callbacks and DMs are not checked by `hasPendingUserContent`. A parked agent waiting on only a callback or DM will not be re-woken by timer — it will be delivered on next natural dequeue or when the next operator message arrives.

### 3.3 EC-1 connect-notify

When a new SSE consumer connects (EC-1 path), TMCP uses `hasAnyPendingContent(sid)` to determine whether to fire an immediate connect-notify. This is broader than the re-notify paths: it catches any pending queue content regardless of type, including events that arrived while the SSE connection was absent.

### 3.4 Multi-session fan-out

| Routing mode | Behavior | Notifies |
|---|---|---|
| Targeted (reply-to, reaction, callback) | Delivered to owning session only | Owner session only |
| Ambiguous (no reply context) | Delivered to governor session | Governor session only |
| Broadcast (no governor, or forced) | Delivered to ALL sessions | All sessions; AC-1 self-notify suppressed |
| Outbound governor copy (`broadcastOutbound`) | Governor receives all outbound events | Governor queue only — no notify, no channel subscriber call |

**AC-1 self-notify filter:** Events originating from a session do NOT notify that session. Implemented via `originatorSid` in `notifySession`. Prevents agents from waking on their own sends.

**`agent_event` fan-out:** POST /event broadcasts `agent_event` service messages to ALL sessions for lifecycle events (compacting, compacted, startup, shutdown_warn, shutdown_complete). The `stopped` kind is suppressed from fan-out entirely (high-frequency noise). `agent_event` messages are silently enqueued — no SSE wake, no channel subscriber call.

**`last_received` asymmetry:** `notifyLastReceived` is called only for targeted routing. Governor-routed (ambiguous) and broadcast-routed messages do NOT update `last_received`. Only messages targeted to a specific session count for reminder tracking.

### 3.5 Channel subscriber vs. SSE

Two notification paths run independently:

- **SSE / activity file (`notifySession`):** Subject to full debounce gate. Gated by `isNotifyTriggerEvent` and `isSilentEvent`. Enforces debounce windows.
- **Channel subscriber (`notifyChannelSubscriber`):** Bypasses both predicates and the debounce gate. Receives all events that are not explicitly excluded (only `send_callback` and outbound governor copies are excluded). Channel consumers receive events immediately, including reactions.

This split means the channel subscriber path receives more events than the SSE path. Whether this is intentional design (channel = raw feed) or a structural gap is addressed in Gap 1 below.

---

## 4. Gaps

Two confirmed gaps relative to the design principles. No fix is prescribed — decisions deferred to Overseer.

### Gap 1 — Channel subscriber notified for reactions (P2 structural violation)

**Location:** `enqueueToSession` and the broadcast fallback loop inside `routeToSession` in `session-queue.ts`.

**Current behavior:** `notifyChannelSubscriber` is called unconditionally for all events including reactions. The `isNotifyTriggerEvent` guard applies only to the SSE/activity-file path, not to the channel subscriber call.

**Effect:** Channel subscribers receive a notification for every reaction. P2 states reactions must not wake — but the enforcement predicate is absent from this code path. In practice, cooldown logic suppresses many downstream effects, but the guard is missing structurally, not coincidentally inactive.

**Status — Confirmed bug (operator confirmed, TG 80045 / Overseer review 2026-06-27):** Reactions MUST NOT wake channel subscribers. The fix is to wrap `notifyChannelSubscriber` in an `isNotifyTriggerEvent` guard at both call sites in `session-queue.ts`. Implementation task: 10-3021. Fix authorized — do not defer.

### Gap 2 — P4 DQ coalescing not implemented

**Current behavior:** Reactions co-deliver in the same DQ batch as the next real message when they arrive before the TemporalQueue heavyweight delimiter. However, each reaction remains an individual DQ item in the queue. There is no merge or coalescing step at the TMCP level.

**Effect:** An agent receiving ten reactions before a real message sees ten separate reaction items in the dequeue array alongside the triggering message. P4 describes "DQ-batched" delivery; the batch occurs, but items are not merged. A heavy reaction storm inflates the DQ array size.

**Status — Operator confirmed (2026-06-27):** The existing batch co-delivery behavior is correct. Reactions accumulate and deliver with the next real message. True per-item merging is not required. Not a required fix. Document as known non-ideal. TemporalQueue changes deferred to future work.

---

## 5. Regression-Safe Behaviors

These behaviors are confirmed correct and MUST NOT change without explicit Overseer authorization.

| Behavior | Location | Why it must not change |
|---|---|---|
| `isNotifyTriggerEvent` returns `false` for `event.event === "reaction"` | `session-queue.ts` | Core P2 enforcement for SSE/activity-file path; removing this wakes agents on every reaction |
| `isSilentEvent` matches `behavior_nudge_*` prefix | `session-queue.ts` | Prevents coaching messages from waking parked agents |
| `isSilentEvent` matches `agent_event` exactly | `session-queue.ts` | Prevents lifecycle fan-outs from waking every session on every compaction |
| `send_callback` no-notify (hardcoded in `deliverAsyncSendCallback`) | `session-queue.ts` | Delivery confirmations are non-actionable housekeeping; waking on them wastes tokens |
| `post_compact_monitor_recovery` wakes actor session only | `session-queue.ts` / `event-endpoint.ts` | Other sessions receive silent `agent_event`; only the compacting actor re-arms monitors |
| 60-second debounce when agent is active in dequeue | `file-state.ts` | Calibrated debounce for active sessions; lowering causes notify storms |
| 300-second debounce when agent is parked / idle | `file-state.ts` | Calibrated debounce for parked agents; lowering causes spurious wake-ups |
| Re-notify check includes `hasPendingReminderContent(sid)` | `file-state.ts` | Ensures reminder-only queues can re-wake a parked agent after debounce expires |
| EC-1 connect-notify uses `hasAnyPendingContent(sid)` | `file-state.ts` | Broader than re-notify check; catches callbacks, DMs, and other types missed while SSE was absent |
| Phase-1 voice suppression (no SSE wake before transcription complete) | `session-queue.ts` | Waking before transcription yields an empty or partial batch; agent gets no useful content |
| Phase-2 voice wake fires after `patchVoiceText` completes | `session-queue.ts` | Guarantees transcript is populated in the queue item when agent dequeues |

---

## 6. Edge Cases

### 6.1 Reactions in DQ but no SSE wake

When a reaction arrives while the agent is parked:

1. Event is enqueued in the TemporalQueue — visible in next `dequeue()` call.
2. `isNotifyTriggerEvent(event)` returns `false` — SSE/activity-file notification suppressed.
3. `notifyChannelSubscriber` IS called (Gap 1).
4. Agent remains parked. No debounce state is written.
5. Real message arrives → `isNotifyTriggerEvent` returns `true` → notify fires → agent wakes → `dequeue()` returns array containing the reaction(s) and the real message in arrival order, up to the TemporalQueue heavyweight delimiter.

The agent sees the reaction in context, not as a standalone interrupt. This is the intended P4 behavior.

Because reactions never write debounce state, a flood of reactions between two real messages is entirely debounce-transparent: the real message notify fires cleanly regardless of how many reactions preceded it.

### 6.2 Voice message phase-1 / phase-2 suppression sequence

Voice messages go through two-phase delivery to guarantee the transcript is present when the agent dequeues.

**Phase-1 (transcription pending):**

- Message enqueued in TemporalQueue with `text: undefined`.
- SSE/activity-file notification suppressed — agent stays parked.
- `notifyChannelSubscriber` IS called (channel receives all events).
- No debounce state written.

**Phase-2 (transcription complete):**

- `patchVoiceText` updates the queued item with the completed transcript.
- `notifySessionWaiters` fires the SSE/activity-file notification.
- Agent wakes, calls `dequeue()`, receives the message with transcript populated.

This two-step sequence guarantees an agent never dequeues a voice message with a missing transcript due to a premature wake. If transcription fails, a `voice_transcription_failed` service message is delivered instead (non-silent; wakes agent).

### 6.3 `post_compact_monitor_recovery` — actor-only delivery

When an agent sends `kind: "compacted"` to POST /event, two separate things happen:

**All sessions (fan-out):**

- Receive `agent_event` service message (`isSilentEvent = true`).
- No SSE wake, no channel subscriber call.
- Informational context only — peers know a compaction occurred.

**Actor session only (`resolvedActorSid`):**

- Receives `post_compact_monitor_recovery` service message.
- NOT gated by `isSilentEvent`.
- SSE/activity-file wake fires for the actor session only.
- Agent must re-arm its SSE monitor and any file-state monitors post-compaction.

If the actor SID cannot be resolved, the recovery message is not delivered. The actor recovers via the standard EC-1 connect-notify on the next SSE connection — `hasAnyPendingContent` catches any pending queue items.

The two-tier design is correct and intentional: peers need awareness but not action; the compacting actor needs both.

---

## 7. Wake Taxonomy (quick reference)

**MUST wake (agent must act):**

- Any `event: "message"` from operator — all `OPERATOR_MESSAGE_TYPES`
- Any `event: "callback"` — button press
- Any `event: "direct_message"` — inter-agent DM
- Any `event: "reminder"` — all trigger types
- Service messages: `post_compact_monitor_recovery`, `post_compact_sse_recovery`, `voice_transcription_failed`, `persistent_animation_running`, `governor_*`, `session_*`, `child_*`, `spawn_child_subagent_hint`, `onboarding_arm_reminder`, `activity_file_monitor_instructions`, `duplicate_session_detected`
- All `onboarding_*` and `compression_hint_*` service messages

**MUST NOT wake (read as context when already running):**

- Any `event: "reaction"` — read for context; NEVER as confirmation or instruction
- Any `event: "send_callback"` — delivery housekeeping; no agent action required
- Service messages matching `behavior_nudge_*` — behavioral coaching during active sessions
- Service messages with `event_type === "agent_event"` — lifecycle fan-out; informational
- `event: "user_edit"` — never appears in DQ

**Never treat as confirmation:**

- Reactions of any emoji (P5). Not 👍, not 💯, not ❤️. Confirmation requires explicit text, voice, or button response from the operator.

---

## §8 — Audit Findings Map (Epic 10-3020)

Audit conducted 2026-06-20 against branch `dev` HEAD `dd803bcc`. This section maps each finding to its disposition against this spec.

| # | Sev | Finding | Status | Sub-task |
|---|-----|---------|--------|----------|
| 1 | HIGH | `agent_event` SSE suppression staged but not committed | ✅ Resolved — `isSilentEvent` gate confirmed active in production | — |
| 2 | HIGH | `notifyChannelSubscriber` not gated on actionability filter | ⚠️ Confirmed bug (Gap 1) — operator confirmed reactions MUST NOT wake channel subscribers. Fix: wrap `notifyChannelSubscriber` in `isNotifyTriggerEvent` guard at both call sites. Implementation task: 10-3021 | 10-3021 |
| 3 | HIGH | Runaway dequeue guard in `dev`, not merged to `master` | ✅ Resolved — 10-0011 merged | — |
| 4 | LOW | `timeout=0` debounce non-release — intentional | ✅ No action needed — intentional design | — |
| 5 | MED | Re-notify timer skips reminder-only queues (§5-b gap) | ✅ Resolved — `hasPendingReminderContent` included in re-notify check (confirmed in §3 of this spec) | — |
| 6 | LOW | `flushPendingChannelNotify` dead export (unwired) | 🔲 Open — implementation task 10-3023. Safe to implement against this spec. | 10-3023 |
| 7 | LOW | `peekCategories` O(N) drain-re-enqueue | 🔲 Open — implementation task 10-3024. Performance optimization, no behavioral change. Safe to implement. | 10-3024 |
| 8 | LOW | Child onboarding msgs fire before `setDequeueActive` | 🔲 Open — implementation task 10-3025. Ordering fix, no wake behavior change. Safe to implement. | 10-3025 |
| 9 | LOW | Concurrent dequeue refcount gap | 🔲 Future work — documented, no immediate task. No spec change required. | — |

**Safe to implement against this spec:** findings 6, 7, 8.
**Requires operator decision before implementation:** finding 2 (Gap 1 fix scope confirmed — file 10-3021).
**Resolved:** findings 1, 3, 4, 5.
**Deferred:** finding 9.

---

*End of specification.*
