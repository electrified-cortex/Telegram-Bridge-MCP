# v7.12.1 — Debounce fix + max_wait:0 documentation cure

**Priority:** P0 — operator-directed, ship ASAP  
**Source:** Dogfood session 2026-06-22, confirmed live by Curator  
**Overseer:** gate foreman dispatch on this spec

---

## Fix 1 — Notify-debounce must persist through content dequeues

### Problem
Current: debounce resets on every successful content dequeue, causing one SSE notify per drain cycle.  
Intended: debounce persists for 5 min regardless of dequeue activity.

### Correct model — two-stage debounce

**Stage 1 — Notify debounce (5 min):** After a notify fires, further messages arriving before the agent dequeues do NOT trigger another notify. Gate: 5 minutes.

**Stage 2 — Dequeue debounce (60 sec):** After the agent dequeues content, the gate resets to 60 seconds. New messages within that window don't fire another notify.

**Cancel condition (both stages):** `timed_out: true` from a blocking dequeue cancels the active debounce immediately — agent is idle, re-arm now.

| Condition | Effect |
|---|---|
| Notify fires, more messages arrive (pre-dequeue) | Suppressed for up to 5 min |
| Agent dequeues content | Debounce reset to **60s** |
| New messages within 60s window | Suppressed |
| 60s expires | Re-armed — next message notifies |
| Agent blocking dequeue → `timed_out: true` | Debounce **cancelled immediately** — re-armed |
| Agent instant-polls empty queue (`max_wait: 0`) | No effect on debounce |

### Fix scope
- `notifyChannelSubscriber` / session debounce reset logic
- Only clear debounce timer on `timed_out: true` response path
- **Test:** send 5 rapid messages; agent dequeues each one with content; verify only ONE notify fires across the full sequence

---

## Fix 2 — Remove `max_wait: 0` as a documented "drain loop" pattern

### Problem
The `dequeue` tool schema documents `max_wait: 0` as: *"Pass 0 for an instant non-blocking poll (drain loops)."*  
This is a footgun: it invites agents into a rapid-poll pattern that (a) burns tokens, (b) never generates `timed_out: true`, and (c) breaks the debounce model.

The zero-result detector (v7.12) is a bandaid, not a cure.

### Fix scope

Option A (preferred): **Remove `max_wait: 0` support entirely** — set minimum to 1s. Agents wanting "drain" behavior should use `max_wait: 5` or `max_wait: 10`.

Option B: **Rewrite the description** to explicitly warn:
> `max_wait: 0` — instant non-blocking poll. ⚠️ Do NOT use in a polling loop: this pattern burns tokens, bypasses the debounce model, and prevents the bridge from detecting agent idle state. Only use for one-shot queue checks at session start.

### Recommendation
Option B — keep `max_wait: 0` as a feature but remove the "drain loops" framing entirely. Rewrite to neutral/cautionary: valid for one-shot checks, not for loops. The description is the vector; fix the description.

---

## Acceptance criteria

- [ ] Rapid-message test: 5 messages sent in burst → only 1 SSE notify fires
- [ ] timed_out test: agent calls `dequeue(max_wait: 30)` with empty queue → `timed_out: true` → new message immediately notifies
- [ ] `max_wait: 0` either removed or carries warning in schema description
- [ ] Existing startup drain (one-shot use of `max_wait: 0` at boot) still works (if Option B chosen)

---

## Also in 7.12.1 scope (from Overseer handoff)

1. `streaming.md` factual error — inactivity vs creation-time expiry description
2. `suppress_pending_hint` dead code cleanup  
3. `anomaly-taxonomy.json` `auto-remediate` placeholder — remove or implement
4. `reactions not waking SSE` — open from prior session
5. `activity/file/touch` vs `activity/poke` — consolidation review
6. `20-2103` — rebase onto master, add AC1 + AC2 guards before re-queue
