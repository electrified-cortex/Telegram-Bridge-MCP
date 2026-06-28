# Thinking Indicator

Telegram's native "Thinking…" draft bubble. Fires automatically on every actionable
dequeue — zero agent effort. The agent can extend and customise it; any real action
supersedes it.

**DM-only** (drafts are private-chat-only). **~30s TTL** (Telegram-native ephemeral).

---

## Auto-lifecycle (default — no agent work needed)

```
operator sends message
       │
       ▼
dequeue returns updates         ← bridge auto-fires Thinking here
       │
       ▼
💭 Thinking… appears in chat
       │
  (agent works)
       │
       ▼
agent sends a response          ← Thinking disappears
       │                           (visually superseded by the real message)
       ▼
✍️ typing… (if show_typing was called)
```

1. **Trigger:** dequeue returns a batch with actionable operator content (text,
   voice, command, photo, doc, video, audio, sticker, etc.).
2. **Not triggered** by empty/timed-out dequeues or service-message-only batches.
3. **30s natural expiry.** For the default case the bridge fires once and lets
   Telegram expire the bubble. No timer, no refresh, no action required.
4. **Superseded automatically** when the agent sends a response.

---

## Refresh semantics — floor, never cap

When a new actionable dequeue fires while Thinking is already active:

```
hold-until = max(hold-until, now + 30s)
```

This **tops up** a near-expiry Thinking to at least 30s but **never shortens**
a longer hold the agent has set. If the agent extended to 2 minutes and a new
message arrives with 90s remaining, the hold stays at 90s.

---

## Supersession — what cancels Thinking vs. what doesn't

**Default rule: Thinking stays up unless a response/composition action fires.**

| Class | Actions | Effect |
|---|---|---|
| **Cancels / transitions** | `send` (text/file/voice/notify/dm), `send(choice/question/confirm/checklist/progress)`, `show_typing`/TTS record, `animation` show | ✖ superseded — response or active composition now visible |
| **Refreshes (floor bump)** | another actionable `dequeue` | ↻ `hold-until = max(hold-until, now+30s)` — never shortens |
| **Leaves Thinking up** | `help`, `download_file`, `transcribe`, `chat/info`, `message/get`/history, `session/*`, `profile/*`, `reminder/*`, `log/*`, `activity/*`, `commands/set`, `react`, `message/pin`/`edit`/`delete` | ○ preparing the response — Thinking stays |

Safe failure mode: Thinking lingers a few extra seconds (≤30s max), then expires
naturally. This is preferable to flash-cancelling on non-response calls.

---

## Agent extension API — one call, bridge owns the rest

Call `action(type: 'thinking/extend', ...)` to take over the auto-started bubble.
Token cost: **open + close = 2 round-trips** regardless of hold duration.
The keep-alive and phase cycling run bridge-side.

### Parameters

| Parameter | Type | Description |
|---|---|---|
| `label` | string (max 200) | Custom text shown as draft body: "Analyzing the codebase…" |
| `phases` | string[] (≥2) | Bridge cycles these on its own timer: live-looking stages |
| `hold` | integer 1–600 | Total seconds to hold (bridge refreshes autonomously within each 30s window) |

All fields are optional. Omit to keep the current value.

### Examples

**Extend with a label (no timer management):**
```
action(type: 'thinking/extend', label: 'Analyzing the codebase…', hold: 120, token: …)
```
Bridge holds for 120s, cycling the draft autonomously. Agent does real work.

**Phase-script for live-looking progress:**
```
action(type: 'thinking/extend',
       phases: ['Reading files', 'Running tests', 'Drafting'],
       hold: 90,
       token: …)
```
Bridge cycles phases every ~8s, giving the operator a live sense of progress.
One tool call — no repeated check-ins.

**Explicit close (optional):**
```
action(type: 'thinking/close', token: …)
```
Usually not needed — the next `send` auto-closes it. Use only if you need to
dismiss Thinking without immediately responding.

---

## Constraints

- **DM-only.** Drafts work only in 1-on-1 private chats (this bridge is 1-on-1 by design).
- **~30s Telegram TTL.** One un-refreshed draft expires in ≤30s. The bridge refreshes
  autonomously for `hold > 30s` — the agent never needs to ping.
- **Stage 1 (current).** Uses `sendMessageDraft` (empty text → generic "Thinking…" bubble).
  `label` / `phases` appear as the draft body text (best-effort — Telegram may or may not
  render them as the bubble label depending on client version).
- **Stage 2 (future).** Will use `sendRichMessageDraft` + `<tg-thinking>` for custom
  thinking text / richer rendering. Same agent contract.

---

## Worked example — long reasoning session

```
// Operator asks a complex question
// dequeue returns it → bridge auto-fires Thinking

// Agent decides this will take 2+ minutes
action(type: 'thinking/extend',
       label: 'Deep analysis in progress…',
       phases: ['Gathering context', 'Cross-referencing', 'Synthesizing'],
       hold: 150,
       token: …)

// Agent does real work — no dequeue pinging, no timer management
// Bridge cycles phases every ~8s for the next 150s

// When done:
send(type: 'text', text: '…full analysis…', token: …)
// Thinking auto-closes; agent didn't need to call thinking/close
```

---

## Related

- `help('dequeue')` — dequeue loop; auto-Thinking fires on every actionable return
- `help('streaming')` — deliberate chunking pattern (append for incremental output)
- `help('show_typing')` — show ✍️ typing indicator (supersedes Thinking)
- `help('animation')` — looping text-frame animation (for longer task progress)
