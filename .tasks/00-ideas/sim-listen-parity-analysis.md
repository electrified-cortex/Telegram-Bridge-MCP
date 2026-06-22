# SIM /listen SSE Parity Analysis: Re-arm Race and Missing Heartbeat

**Date:** 2026-06-11  
**Scope:** Read-only. `electrified-cortex/simple-im/` only. No code changes made.  
**Analogy target:** Telegram EC-1 (re-arm race on reconnect) and EC-2 (no SSE keepalive).

---

## Summary

**SIM has the re-arm race (EC-1 equivalent): YES.**  
**SIM has the missing heartbeat (EC-2 equivalent): YES.**

The exact miss sequence and the #1 fix are described in the Verdict section.

---

## 1. /listen Connect Path (file:line)

**HTTP layer** — `src/http.rs:757-792`  
`handle_listen` calls `state.hub.open_listen(existing_token, peer_ip, name_to_bind)` and wraps
the returned `mpsc::UnboundedReceiver<String>` in an `SseDropGuard` whose `on_drop` closure calls
`state_for_drop.hub.close_listen(&token_for_drop)`.

**Hub layer** — `src/delivery.rs:2028-2187` (`open_listen`)

Step-by-step on a reconnect with an existing token:

1. **Lock acquired** (line 2035).
2. `gc_tokens()` runs (line 2036).
3. If the provided token exists and is not revoked, reuse it (lines 2038-2044).
4. A new `(tx, rx)` mpsc pair is created (line 2059).
5. Belt-and-suspenders: if the token has a stored name missing from `name_to_token`, re-insert (lines 2063-2072).
6. Concurrent-use IP check (lines 2076-2104).
7. **Old sender replaced atomically:** `state.sse_sender.replace(tx.clone())` (line 2109).  
   If an old sender existed, a `superseded` service event is sent to it (lines 2112-2115).
8. `state.ever_listened = true` (lines 2118-2121).
9. `sse_connections` count incremented (line 2122).
10. Inline name binding attempted if `name_to_bind` was supplied (lines 2125-2157).
11. **Welcome event sent** (lines 2161-2169): `{"type":"service","event":"welcome","token":"...","name_in_use":false,...}`.
12. Lock released (line 2172).

**What is NOT done on reconnect:** No check for `kick_pending` or non-empty `message_queues` for the
agent. No catch-up NOTIFY is sent. `notify_suppressed` is not reset here.

---

## 2. Replay on Reconnect — The EC-1 Equivalent

**Answer: NO replay, NO catch-up notify.** The re-arm race is present.

`open_listen` sends only the `welcome` event (line 2169). It does not:
- inspect `kick_pending` (defined at `delivery.rs:226`),
- inspect `message_queues` (line 224),
- reset `notify_suppressed` (line 162), or
- call `take_notify` or any equivalent.

The function `kick_pending_for(name)` exists at `delivery.rs:1956` and would provide the check, but
it is called only from test assertions (lines 2664, 2667, 2672) — never from `open_listen`.

`take_notify` (delivery.rs:288-299) is the edge-triggered gate. It fires one NOTIFY on message
arrival and sets `notify_suppressed = true`. It only fires again after a dequeue clears the flag
(delivery.rs:2332-2334 in `dequeue`, delivery.rs:2374-2376 in `drain_queue`).

If the old SSE connection dropped after a NOTIFY was fired (`notify_suppressed = true`) but before
the agent dequeued, the reconnected stream starts with `notify_suppressed` still `true`. The very
next `send()` will hit `take_notify` → `if state.notify_suppressed { return None }` (line 292) →
no NOTIFY fired. Only after the agent dequeues (which it cannot know to do without a prior NOTIFY)
will `notify_suppressed` reset, allowing the next future send to fire.

---

## 3. `notify_suppressed` Reset Trace

All locations where `notify_suppressed` is written:

| Location | Value set | When |
|---|---|---|
| `V2TokenState::new()` — `delivery.rs:178` | `false` | Token first created |
| `take_notify()` — `delivery.rs:295` | `true` | NOTIFY fired on message delivery |
| `dequeue()` — `delivery.rs:2332-2334` | `false` | Agent calls POST /messages/dequeue |
| `drain_queue()` — `delivery.rs:2374-2376` | `false` | Agent calls POST /messages/dequeue/all |

**`open_listen` does NOT reset `notify_suppressed`.** There is no reset in `close_listen`
(`delivery.rs:2190-2204`) either. The flag persists across SSE disconnect/reconnect cycles.

### The Stuck-Suppressed Scenario

1. Sender enqueues message M1 → `send()` calls `take_notify()` → NOTIFY fired, `notify_suppressed = true`.
2. Agent receives NOTIFY on SSE, starts to dequeue — but connection drops before the dequeue HTTP
   call completes (or is initiated). `notify_suppressed` stays `true`.
3. Agent reconnects (`open_listen`). Welcome event arrives. Queue still has M1. `notify_suppressed` is still `true`.
4. A second message M2 arrives → `send()` calls `take_notify()` → `notify_suppressed` is `true` →
   returns `None` → **no NOTIFY sent to the live SSE stream**.
5. Agent never polls. M1 and M2 sit in queue indefinitely.

---

## 4. Heartbeat / Keepalive (EC-2 Equivalent)

**No SSE keepalive exists.**

Search across all of `src/` for `keepalive`, `heartbeat`, `ping`, `keep-alive`, and SSE comment
events (`:\n\n`) returned zero matches in `src/delivery.rs` and `src/http.rs`.

The `handle_listen` handler (`http.rs:783-791`) returns `Sse::new(stream).into_response()` with no
keepalive interval or comment event stream. The underlying `SseDropGuard` stream only yields items
when the mpsc channel produces a message.

On a half-open TCP connection (e.g., NAT timeout, network flip without TCP RST), both:
- the server will not detect the dead socket (no write attempts without a message), and
- the `UnboundedReceiverStream` will not yield EOF.

The drop guard's `on_drop` closure (`close_listen`) will not fire, so `sse_connections` count stays
elevated and `is_sse_alive_in_hub` returns `true`. Any subsequent `send()` will attempt to send
NOTIFY over a dead channel — the mpsc send succeeds locally (returns `Ok(())`) because the channel
is buffered and Rust's mpsc does not know the TCP socket is dead. The agent never wakes.

---

## 5. Verdict: Does SIM Have the Re-arm Race?

**Yes. Two distinct bugs, analogous to EC-1 and EC-2.**

### Bug SIM-1 (Re-arm Race, EC-1 analogue) — Severity: HIGH

**Exact miss sequence:**

```
T0: Message M arrives for agent A.
    send() → take_notify() → NOTIFY sent on SSE → notify_suppressed = true.

T1: Agent A's curl SSE connection drops (network blip, container restart, 2s backoff).
    close_listen() fires: sse_connections count decremented → 0, removed.
    notify_suppressed is NOT reset.

T2: Agent A reconnects: open_listen() → welcome event sent.
    Queue still contains M. notify_suppressed is still true.
    No catch-up NOTIFY is sent.

T3: Any number of new messages may arrive.
    Each send() calls take_notify() → notify_suppressed=true → returns None.
    No NOTIFY ever reaches the live SSE stream.

T4: Agent A never calls dequeue (no wake signal), queue grows unboundedly.
    Agent is effectively deaf until it dequeues by some out-of-band mechanism.
```

The 2-second reconnect sleep in `monitor.sh` (line 79) is the exact gap. Any message enqueued
during `[T1, T2]` (during or before reconnect) triggers the race.

### Bug SIM-2 (No Keepalive, EC-2 analogue) — Severity: MEDIUM

Half-open TCP sockets are not detected. The server believes the agent is online (SSE count > 0),
fires NOTIFY into a dead buffered channel, and the agent never wakes. Silent indefinitely.

---

## Recommended Fix Sketch

### Fix for SIM-1 (mirroring Telegram EC-1 fix)

In `open_listen` (`delivery.rs:2028`), after the welcome event is sent and the lock is still held
(or re-acquired briefly), check whether the agent (by name, looked up from `token_to_name`) has
pending messages and, if so:

1. Reset `notify_suppressed = false` for this token.
2. Emit an immediate NOTIFY event on the new `tx` channel with the pending count.

Pseudocode sketch (inside the lock, after line 2169):

```rust
// Catch-up NOTIFY on reconnect if pending messages exist.
if let Some(name) = inner.token_to_name.get(&token).cloned() {
    let pending = inner.message_queues.get(&name).map(|q| q.len()).unwrap_or(0);
    if pending > 0 {
        if let Some(st) = inner.listen_tokens.get_mut(&token) {
            st.notify_suppressed = false;   // re-arm interlock
        }
        let _ = tx.send(format!(r#"{{"type":"notify","pending":{}}}"#, pending));
    }
}
```

This mirrors the Telegram EC-1 fix exactly: on (re)connect, if there is pending content, fire the
catch-up wake immediately so the agent dequeues without waiting for the next arriving message.

### Fix for SIM-2 (keepalive)

Add a periodic SSE comment event (`: keep-alive\n\n`) using axum's `Sse::keep_alive()` or a
`tokio::time::interval` merged into the SSE stream. This causes TCP write probes so half-open
sockets are detected and the drop guard fires.

---

## File References (all line numbers verified against current source)

- `src/delivery.rs:162` — `notify_suppressed` field declaration
- `src/delivery.rs:178` — initialized `false`
- `src/delivery.rs:288-299` — `take_notify()` (edge-trigger + suppression set)
- `src/delivery.rs:292` — `if state.notify_suppressed || !is_alive { return None }`
- `src/delivery.rs:295` — `state.notify_suppressed = true`
- `src/delivery.rs:1956` — `kick_pending_for()` (exists but not called from open_listen)
- `src/delivery.rs:2028-2187` — `open_listen()` — no catch-up NOTIFY, no notify_suppressed reset
- `src/delivery.rs:2169` — welcome event sent (only event on reconnect)
- `src/delivery.rs:2190-2204` — `close_listen()` — no notify_suppressed reset
- `src/delivery.rs:2332-2334` — `notify_suppressed = false` in `dequeue()`
- `src/delivery.rs:2374-2376` — `notify_suppressed = false` in `drain_queue()`
- `src/http.rs:757-792` — `handle_listen` — no keepalive on Sse response
- `src/http.rs:783-791` — `Sse::new(stream).into_response()` — no `.keep_alive()`
- `skills/participant/monitor.sh:79` — `sleep 2` reconnect gap
