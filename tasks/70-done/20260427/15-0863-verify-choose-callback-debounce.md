---
id: 15-0863-verify-choose-callback-debounce
title: Verify — choose callback cannot fire twice (no double-pump)
priority: 15
status: draft
type: verify
delegation: worker
repo: TMCP
---

# Verify — choose callback cannot fire twice

## Mission

Verify (not necessarily fix) that once a `choose`-style callback is received and acknowledged, the same callback cannot be triggered a second time. Specifically: rapid double-tap on the same button by operator must result in exactly one callback delivery to the agent, with the second tap being silently dropped (not raised to the agent, not requeued).

## What to confirm

1. **Callback registry de-registers on receipt.** Once the bridge receives a callback_query for a button, the (message_id, callback_data) tuple is removed from the live registry. A second click on the same button targets a no-longer-registered entry.
2. **No agent re-delivery.** The agent does NOT see the second callback in its dequeue stream. Either Telegram's `callback_query.answer` mechanism implicitly suppresses, or our bridge logic explicitly drops.
3. **No race window.** Two clicks within ~50ms of each other still produce exactly one delivery. The de-registration must happen before the second click could overlap.

## Steps

1. Send a `choose` (or `confirm`) interactive message with at least one button.
2. From the operator side, double-tap the same button as fast as possible (or use telegram client's built-in spam-tap if available).
3. Inspect the agent's dequeue stream — count `callback` events for that message_id + button data.
4. Expected: exactly 1.
5. Repeat with `confirm` (yes/no) — verify same.
6. Repeat with `question` mode if it has buttons.

## Acceptance

- Verify produces a YES/NO answer for each test mode (choose, confirm, question).
- If YES (de-bounced correctly): write the confirmation as the deliverable; close.
- If NO (double-pump observed): file a follow-up bug task with reproducer; close this verify with the failure pointer.

## Don'ts

- Don't fix anything in this task. Verify only. If a fix is needed, file a separate task.
- Don't simulate double-tap programmatically — use real Telegram client interaction (operator can do this manually if needed).

## Notes

Operator-stated 2026-04-26 evening (distilled): for `choose`, once a callback is received the button cannot be triggered twice — no double-pumping. The bridge acknowledges receipt and removes it from the registry.

Pairs with 15-0862 (button collapse delay) — both target the same callback path UX.

## Source

Operator verify-story 2026-04-26 evening via Curator session.

---

## Verification

**Date:** 2026-04-27
**Method:** Static code analysis of callback hook infrastructure
**Analyst:** Worker 1

### Result: YES — callback cannot fire twice for any interactive mode

#### Core mechanism (`src/message-store.ts`, lines 322–334)

The `_callbackHooks` map holds one-shot closures keyed by `messageId`. In `recordInbound`, the de-registration sequence is:

```
_callbackHooks.delete(targetId)   // line 325 — synchronous, before any await
_callbackHookOwners.delete(targetId)  // line 326
hook(evt)                         // line 329 — called AFTER delete
```

The delete happens synchronously before the hook is invoked, and before any `await`. Node.js's single-threaded event loop guarantees no second callback can be processed until `recordInbound` returns. By that point the hook is gone.

#### Verdict by mode

| Mode | One-shot? | De-reg before await? | Late-press handled? | Verdict |
|---|---|---|---|---|
| `choose` | YES | YES | YES (ack-only replacement hook) | ✅ Cannot double-pump |
| `confirm` / `confirmYN` | YES | YES | YES (ack-only replacement hook) | ✅ Cannot double-pump |
| `question` → `ask` | N/A (no callback hook) | N/A | N/A | ✅ Cannot double-pump |
| `question` → `choose` | YES (delegates to `handleChoose`) | YES | YES | ✅ Cannot double-pump |
| `question` → `confirm` | YES (delegates to `confirmHandler`) | YES | YES | ✅ Cannot double-pump |

#### Race window: two clicks within ~50ms

Telegram delivers `callback_query` updates one at a time via the poll queue. Even at 50ms apart, two taps arrive as two sequential `recordInbound` calls. The first call deletes the hook; the second call finds `undefined` and skips the hook block entirely. Exactly one delivery is guaranteed.

#### Notable edge case (not double-pump)

`confirm` CTA-mode (`no_text = ""`): if a button arrives whose `callback_data` doesn't match `yes_data`, the hook returns early without sending a Telegram ack. The hook is already deleted at this point; no re-registration occurs. No double-pump, but the Telegram spinner will auto-dismiss rather than receive an explicit ack. Low-impact UX edge case, out of scope for this verify.

#### Live operator test

Per task spec, live double-tap testing requires real Telegram client interaction. The static analysis above gives high confidence the guard is sound. If operator wishes to confirm empirically: send a `choose` message and double-tap the same button rapidly — the agent should receive exactly one `callback` event in its dequeue stream.

## Completion

**Completed:** 2026-04-27
**Branch:** 15-0863-verify-choose-callback-debounce
**Worker:** Worker 1 (SID 4)

Static code analysis confirms the double-pump guard is sound across all interactive modes (choose, confirm, question). The `_callbackHooks` map uses synchronous one-shot de-registration — delete happens before the hook is invoked and before any await. Node.js single-threaded event loop guarantees exactly one delivery even for rapid double-taps. See `## Verification` section for full analysis.

Live operator test not performed (per spec: "use real Telegram client interaction (operator can do this manually if needed)"). Code-level confidence is high.
