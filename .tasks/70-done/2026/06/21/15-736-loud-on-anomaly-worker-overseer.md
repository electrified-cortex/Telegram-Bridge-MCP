---
id: "15-736"
created: 2026-04-19
updated: 2026-06-20
status: needs-refinement
priority: 15
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
branch: dev
blocked_on: "Curator anomaly taxonomy spec — list of anomaly categories must be defined in a data file before Worker can implement the classifier"
dispatch_ready: true
needs_operator: false
---

# 15-736 - Loud-on-anomaly for Worker/Overseer loops

## Context

Observed 2026-04-19: hours of friction on the complete.ps1 hash incident were hidden behind quiet retries. Workers and Overseer kept looping through failures - "Script integrity check failed" - without any of them escalating to the operator that the fleet was stuck on the same error class repeatedly.

Silent retry is the wrong default for *anomalous* failures (repeated hook denials, repeated claim collisions, repeated git push rejections). The fleet should be *loud* the first time something unexpected happens, not log-and-continue.

## Acceptance Criteria

1. Define an "anomaly" classification in the worker/overseer loop: errors that are NOT part of normal flow (hook denial, unexpected non-zero exit from pipeline scripts, git push rejection not caused by fast-forward, unexpected dequeue shape, etc.).
2. On the first occurrence of an anomaly within a session, surface a service message or DM to Curator (NOT the operator directly - Curator decides whether to escalate).
3. On the second occurrence of the *same* anomaly category within a short window, surface directly to the operator.
4. Normal-flow errors (empty queue, already-claimed task, merge conflict during claim retry) stay quiet - this is not about silencing *those*.
5. Regression test: simulate a repeated hook denial, assert escalation fires on the 2nd occurrence within the window.

## Constraints

- Do not spam. Rate-limit. One escalation per anomaly category per session window (default 10 minutes).
- Do not wake the operator for recoverable conditions. Recoverable goes to Curator; persistent/unrecoverable goes to operator.
- The anomaly classifier must be extensible - list of categories in a data file, not inline if/else.

## Priority

15 - observability bug. Root cause of the 2026-04-19 friction spiral being so long.

## Delegation

Worker (TMCP). Curator should spec the anomaly taxonomy before claim.

## Anomaly Taxonomy

Classifier data file. Each entry is one anomaly category. The Worker must implement a classifier that:
- Matches runtime events to a category by its `detection_signal`
- Tracks per-category occurrence counts within a rolling `window_ms` (default: 600 000 ms / 10 min, per Constraints)
- Routes `first` occurrence to Curator; `second` occurrence within the window to operator
- Applies the `action` for the *current* occurrence count

Severity ladder: WARN < ERROR < CRITICAL. Escalation always goes up, never down within a window.

Codebase anchor notes used below:
- Error codes reference `TelegramErrorCode` union in `src/telegram.ts`
- Log tags reference `process.stderr.write("[tag] ...")` conventions in `src/telegram.ts` and `src/poller.ts`
- `behavior_runaway_dequeue` and its thresholds (`RATE_WINDOW_MS=60_000`, `RATE_THRESHOLD=20`) are in `src/tools/dequeue.ts`
- `HEALTH_THRESHOLD_MS=900_000` (15 min silence) is in `src/health-check.ts`
- `SSE_RECONNECT_DELAY_MS=1000` with infinite reconnect loop is in `src/launcher.ts`
- `FATAL_STATUS_CODES = new Set([401, 403])` poller stop is in `src/poller.ts`

---

### AUTH anomalies

```yaml
- slug: auth_repeated_failure
  name: Repeated Auth Failures
  detection_signal: >
    requireAuth() returns AUTH_FAILED or SID_REQUIRED for the same caller
    (tool name + source IP if available) 3+ times within window_ms.
    Error codes: AUTH_FAILED, SID_REQUIRED (src/telegram.ts TelegramErrorCode).
  severity: ERROR
  action:
    first: notify-governor        # Curator decides — may be a confused agent
    second: alert-loud            # Persistent; likely rogue or misconfigured client
  notes: >
    Single AUTH_FAILED is normal (stale token on reconnect).
    Threshold=3 prevents noise from a single bad request.

- slug: auth_invalid_token_pattern
  name: Invalid Token / Suspicious Auth Pattern
  detection_signal: >
    HTTP 401 returned by any endpoint AND the token value does not match the
    known session token format (wrong length, wrong prefix, or entirely absent).
    Also fires on UNAUTHORIZED / UNAUTHORIZED_SENDER / UNAUTHORIZED_CHAT codes.
  severity: ERROR
  action:
    first: notify-governor
    second: alert-loud
  notes: >
    Distinguishes structural invalidity from a simple expired token.
    UNAUTHORIZED_SENDER / UNAUTHORIZED_CHAT indicate a chat-scope mismatch,
    not just a bad credential; these warrant loud escalation sooner.

- slug: auth_governor_gate_repeated
  name: Repeated Governor Gate Denial
  detection_signal: >
    NOT_GOVERNOR, PERMISSION_DENIED, or NOT_GOVERNOR_MODE returned to the same
    session (sid) 2+ times within window_ms.
  severity: WARN
  action:
    first: log-only               # Single denial is normal capability check
    second: notify-governor       # Repeated = likely misconfigured routing
  notes: >
    Governor promotions and changes fire their own service messages already
    (governor_changed, governor_promoted). This covers the *denial* side.
```

---

### SESSION anomalies

```yaml
- slug: session_unexpected_disconnect
  name: Unexpected Session Disconnect
  detection_signal: >
    Session closes without a session_close_signal TraceEvent or without the
    operator initiating /end. Detectable as a session_close TraceEntry where
    detail does not contain "operator" or "graceful".
  severity: ERROR
  action:
    first: notify-governor
    second: alert-loud
  notes: >
    Graceful /end and normal compact-recovery are not anomalies.
    post_compact_monitor_recovery and post_compact_sse_recovery service
    messages are already emitted by the existing behavior system; this
    category covers crashes and unclean drops only.

- slug: session_reconnect_storm
  name: Reconnect Storm
  detection_signal: >
    SSE launcher (src/launcher.ts) fires SSE_RECONNECT_DELAY_MS reconnects
    5+ times within 60 000 ms, indicating the SSE stream cannot stay up.
    Proxy: count "[sse]" stderr lines with "reconnect" within the window.
  severity: ERROR
  action:
    first: notify-governor
    second: alert-loud            # Infrastructure likely unhealthy
  notes: >
    Normal reconnect (network blip) is 1-2 cycles. 5+ in 60 s is a storm.

- slug: session_ghost
  name: Ghost Session (Duplicate SID)
  detection_signal: >
    duplicate_session_detected service message fired, OR
    DUAL_INSTANCE_CONFLICT TelegramErrorCode raised (HTTP 409 / update_id gap
    detected by advanceOffset() in src/poller.ts).
  severity: CRITICAL
  action:
    first: alert-loud             # Two instances competing — data corruption risk
    second: auto-remediate        # Kill younger instance; already done by hijack logic
  notes: >
    fireHijackNotification() already handles remediation. The classifier
    should still fire alert-loud so the governor gets an explicit anomaly
    record, not just a service message buried in chat.

- slug: session_sub_limit_exceeded
  name: Sub-session Limit Exceeded
  detection_signal: >
    SUB_SESSION_LIMIT error code returned on session/start.
  severity: WARN
  action:
    first: notify-governor
    second: notify-governor       # Repeat = operator may have forgotten open sessions
  notes: Single escalation path; operator does not need to be woken for this.
```

---

### RATE anomalies

```yaml
- slug: rate_runaway_dequeue
  name: Runaway Dequeue
  detection_signal: >
    behavior_runaway_dequeue service message emitted, OR dequeue call count
    exceeds RATE_THRESHOLD (20) within RATE_WINDOW_MS (60 000 ms).
    Source: src/tools/dequeue.ts constants.
  severity: ERROR
  action:
    first: notify-governor        # behavior_runaway_dequeue already fires; amplify it
    second: alert-loud
  notes: >
    The existing runaway-dequeue behavior nudge is a WARN-level service
    message. This anomaly category gives it an escalation path on repetition.

- slug: rate_message_flood
  name: Outbound Message Flood
  detection_signal: >
    send or action tool called >15 times within 60 000 ms from a single sid,
    OR RATE_LIMITED TelegramErrorCode fires 3+ times within window_ms.
    Telegram's rate limiter (src/rate-limiter.ts, debounceSend) is the source.
  severity: ERROR
  action:
    first: notify-governor
    second: alert-loud
  notes: >
    debounceSend enforces >=1000 ms between sends. Repeated RATE_LIMITED
    means the caller is racing the debounce — not normal agent behavior.

- slug: rate_api_burst
  name: API Call Burst (429 Repeated)
  detection_signal: >
    callApi() retries exhaust (3 retries, capped at 60 s) and still returns
    RATE_LIMITED, meaning Telegram's 429 persists beyond the retry window.
    Source: callApi() retry logic in src/telegram.ts.
  severity: WARN
  action:
    first: log-only               # Single burst is self-healing via retry
    second: notify-governor       # Sustained burst = session behavior problem
  notes: >
    Poller 429 is handled separately (auto-retry with retry_after). This
    category targets tool-layer API calls that exhaust their own retry budget.
```

---

### DELIVERY anomalies

```yaml
- slug: delivery_repeated_failure
  name: Repeated Message Delivery Failure
  detection_signal: >
    message_deliver TraceEntry with result="error" for the same sid fires 3+
    times within window_ms. Covers both sync and async-send paths.
    Async-send failure: AsyncSendCallbackPayload.status == "failed" | "timeout"
    (src/async-send-queue.ts).
  severity: ERROR
  action:
    first: notify-governor
    second: alert-loud
  notes: >
    Single delivery failures (e.g., transient network) are expected.
    Repeated failure to the same session suggests BOT_BLOCKED, chat deletion,
    or a routing misconfiguration.

- slug: delivery_tts_timeout
  name: TTS / Voice Delivery Timeout
  detection_signal: >
    tts_timeout error code raised (Promise.race in TTS path, src/telegram.ts),
    OR deliverVoiceTranscriptionFailed() called with reason="service_timeout"
    2+ times within window_ms.
  severity: WARN
  action:
    first: log-only
    second: notify-governor       # Repeated TTS timeout = upstream service issue
  notes: >
    Single TTS timeout is common on slow network. Repeated is a service signal.

- slug: delivery_async_send_timeout
  name: Async-Send Timeout (Dead Job)
  detection_signal: >
    ASYNC_SEND_TIMEOUT discriminant fires in async-send-queue, meaning the
    async job did not complete before the safety timeout expired.
    Source: src/async-send-queue.ts RecordingIndicatorState.
  severity: ERROR
  action:
    first: notify-governor
    second: alert-loud
  notes: >
    The double-callback guard (_finalisedJobs) prevents duplicate processing,
    but the timeout itself means content was likely lost. Governor must decide
    whether to retry or notify user.

- slug: delivery_queue_eviction
  name: Message Queue Eviction (Silent Drop)
  detection_signal: >
    TemporalQueue maxSize exceeded, causing silent eviction. Proxy signal:
    a message enqueued but never appears in a dequeue TraceEntry within
    2x the expected drain interval.
  severity: ERROR
  action:
    first: notify-governor
    second: alert-loud
  notes: >
    Current behavior is a silent drop with no log. The classifier should
    instrument the eviction path with an explicit trace event (implementation
    detail for Worker). Until then, use the proxy signal above.
```

---

### INFRASTRUCTURE anomalies

```yaml
- slug: infra_server_unavailable
  name: Server / Poller Unavailable
  detection_signal: >
    FATAL_STATUS_CODES (401, 403) returned from Telegram poller, causing
    poller to stop. Source: src/poller.ts. Proxy: "[poller]" stderr line
    containing "stopping" or "fatal".
  severity: CRITICAL
  action:
    first: alert-loud             # Poller stop = entire bot offline
    second: alert-loud            # No window logic needed — always critical
  notes: >
    401 = bot token revoked or rotated. 403 = bot kicked from all chats.
    Both require immediate operator intervention. Auto-remediation is not
    possible without a new token.

- slug: infra_sse_stream_drop
  name: SSE Stream Persistent Drop
  detection_signal: >
    Same as session_reconnect_storm but evaluated over a longer window
    (window_ms): SSE launcher reconnects >10 times within window_ms (600 000 ms),
    OR health-check HEALTH_THRESHOLD_MS (900 000 ms / 15 min) silence
    triggers unhealthy signal (src/health-check.ts).
  severity: ERROR
  action:
    first: notify-governor
    second: alert-loud
  notes: >
    session_reconnect_storm covers short bursts. This category covers
    sustained degradation over the full session window.
    post_compact_sse_recovery is the existing recovery signal; anomaly fires
    when recovery does not succeed within the window.

- slug: infra_memory_pressure
  name: Memory Pressure Signal
  detection_signal: >
    process.memoryUsage().heapUsed exceeds 85% of heapTotal, sampled at
    health-check interval (CHECK_INTERVAL_MS = 60 000 ms, src/health-check.ts).
    Or Node.js emits an "uncaughtException" with code "ERR_OUT_OF_MEMORY".
  severity: WARN
  action:
    first: notify-governor        # Curator may choose to compact or restart
    second: alert-loud
  notes: >
    No existing memory metric is tracked. Worker must add the heap sample to
    the health-check loop. Threshold of 85% is a starting point; make it
    configurable via env var (TMCP_MEMORY_WARN_PCT).

- slug: infra_activity_file_failure
  name: Activity File Read/Write Failure
  detection_signal: >
    READ_FAILED or WRITE_FAILED error codes returned from activity file ops,
    OR ENOENT retry budget (RETRY_DELAYS=[1_000, 5_000]) exhausted without
    recovery. Source: src/tools/activity/file-state.ts.
  severity: ERROR
  action:
    first: notify-governor
    second: alert-loud
  notes: >
    Single ENOENT is self-healing (recreate dir+file). Exhausted retry budget
    means the filesystem is in an unexpected state — operator must inspect.
```

---

### Implementation notes for Worker

1. Store taxonomy as a JSON or YAML data file (e.g., `src/anomaly-taxonomy.yaml`). Do not hardcode categories inline.
2. Classifier entry point: `classifyAnomalyEvent(event: AnomalyEvent): AnomalyCategory | null`. Returns null for normal-flow errors.
3. Counter store: `Map<slug, { count: number; window_start: number }>`. Reset when `Date.now() - window_start > window_ms`.
4. Normal-flow errors (empty queue, already-claimed task, merge conflict) must NOT match any category. Recommended: maintain an explicit exclusion list keyed on `TelegramErrorCode`.
5. Escalation routing: `count === 1` → DM Curator session (governor sid). `count === 2` → DM operator (hard-coded chat id or env var). `count > 2` → suppress within window (no spam).
6. For `auto-remediate` actions, call the existing remediation path (e.g., hijack logic for ghost sessions) AND fire the alert-loud notification so there is an explicit record.

## Related

- Memory `feedback_dont_add_scripts_where_plain_ops_work.md` (the incident this would have caught earlier).
- 20-735 (adaptive scan; shares the worker loop surface).
- 15-734 (hook error disambiguation; the classifier can key off the new error codes).


## Verification

APPROVED: 15-736 — 2026-06-22
Verifier: a0e59f0315c389123
AC1 (anomaly taxonomy + classifier): CONFIRMED — anomaly-taxonomy.json (18 categories), anomaly-classifier.ts classifyAnomalyEvent()
AC2 (first occurrence → governor): CONFIRMED — reportAnomaly() count=1 → notify-governor
AC3 (second occurrence → operator): CONFIRMED — count=2 → alert-loud
AC4 (normal-flow quiet): CONFIRMED — NORMAL_FLOW_CODES set, returns null
AC5 (regression test hook denial): CONFIRMED — 35 tests, all pass
Test gate: CONFIRMED — .temp/test-results.md + test-plan.md present; 3641 tests pass
Sealed-By: foreman
