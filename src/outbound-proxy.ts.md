# Outbound Proxy — Design Document

> Every outbound Telegram send passes through a single proxy layer
> that handles **all** cross-cutting concerns: cancel typing, expire
> temp messages, promote animation, and record the message — automatically,
> transparently, without any tool knowing about it.

---

## Problem

Every outbound tool (`send_text`, `notify`, `send_new_checklist`, `send_file`,
`send_text_as_voice`, `ask`, `choose`, `confirm`) manually calls
the same boilerplate before and after each send:

```typescript
cancelTyping();           // stop "typing..." indicator
clearPendingTemp();       // expire ephemeral messages
promoteAnimation(...);    // or suspendAnimation() / resumeAnimation()
// ... actual API call ...
recordOutgoing(...);      // log to message store
```

This is scattered across 10+ files, fragile, and violates separation
of concerns. A new tool must remember all four steps or bugs appear.

---

## Mission

A single centralized proxy intercepts outbound sends and runs
cross-cutting logic automatically:

**Before every outbound send:**

1. `cancelTyping()` — stop the "typing..." chat action
1. `clearPendingTemp()` — signal ephemeral messages to expire (accelerate
   their TTL, don't delete instantly — give the user a chance to read)
1. Animation promote (if active):
   - **Text sends** — edit animation message → real content, start new
     animation below, return repurposed `message_id` to caller
   - **File sends** — delete animation placeholder, let file send
     proceed, start new animation below

**After every outbound send:**

1. `recordOutgoing(message_id, contentType, text, caption)` — log to
   message store timeline

**Edit sends** (`editMessageText`) — no interception of the send itself,
but animation timeout resets.

Tools never import from `animation-state`, `typing-state`,
`temp-message`, or `message-store`. They just call the API.

---

## Architecture: Proxy API

Rather than a hook registry, event emitter, or observable stream —
wrap `getApi()` in a **Proxy** that intercepts outbound method calls.

```text
Tool calls:  getApi().sendMessage(chatId, text, opts)
                │
                ▼
         ProxiedApi.sendMessage(chatId, text, opts)
                │
                ├─ 1. cancelTyping()
                ├─ 2. clearPendingTemp()
                ├─ 3. animation active?
                │      TEXT  → editMessageText(animMsgId, text)
                │               the send *becomes* the animation message
                │               + recordOutgoing(animMsgId, ...)
                │               + startAnimation() below
                │               + return { message_id: animMsgId }
                │
                │      FILE  → deleteMessage(animMsgId)
                │               + send file normally
                │               + recordOutgoing(msg.message_id, ...)
                │               + startAnimation() below
                │               + return result
                │
                │      NONE  → send normally
                │               + recordOutgoing(msg.message_id, ...)
                │               + return result
                │
                ▼
          Grammy Api (real Telegram calls)
```

### Why a Proxy, not hooks/events/RxJS?

| Approach | Drawback |
| --- | --- |
| Hook registry | Tools still call `getApi()` directly — hooks can't intercept or replace the return value. Need a wrapper anyway. |
| Event emitter | Pre-send events can't return a substitute message\_id back to the caller. Async coordination is messy. |
| RxJS observable | Adds a dependency for one interception point. Observable streams model data flow, not request/response interception. |
| **Proxy** | Zero new dependencies. Intercepts at the exact call site. Can return substitute results. Tools unchanged. |

The Proxy pattern is the standard JS mechanism for transparent method
interception — it's exactly what this problem calls for.

---

## Intercepted Methods

| Grammy method | Pre-send | Animation behavior | Post-send |
| --- | --- | --- | --- |
| `sendMessage` | typing + temp | Promote (edit-in-place) | record |
| `sendPhoto` | typing + temp | Delete + re-create (file) | record |
| `sendVideo` | typing + temp | Delete + re-create (file) | record |
| `sendAudio` | typing + temp | Delete + re-create (file) | record |
| `sendDocument` | typing + temp | Delete + re-create (file) | record |
| `editMessageText` | — | Reset timeout only | — |

**Not intercepted:** `deleteMessage`, `setMessageReaction`, `getUpdates`,
`getChat`, `setMyCommands`, `getFile`, etc. — read/admin operations.

`sendVoiceDirect()` is a custom fetch call, not a Grammy method. It needs
a separate one-line integration: call `beforeFileSend()` / `afterFileSend()`
around the fetch. Two calls in one place — acceptable.

---

## Recording Nuance

The proxy sees the **formatted** text (post-MarkdownV2 conversion) but
`recordOutgoing` ideally wants the **raw** text for readability. Two options:

1. **Record formatted text** — simpler, proxy has it. Slightly less
   readable in session logs but functionally correct.
2. **Opt-in raw text** — tool can attach raw text to the API options
   via a non-Telegram field (e.g., `_rawText`), proxy reads and strips
   it before forwarding. Clean separation, tools that care can provide it.

Option 2 is cleaner. The proxy checks `opts._rawText` and uses it for
recording if present, otherwise records the formatted text. Tools that
do markdown conversion can pass the original; tools that don't, don't care.

---

## Implementation Detail

### 1. `outbound-proxy.ts` (new module, ~120 lines)

Creates a JS Proxy wrapping the Grammy `Api` instance. Intercepts
`sendMessage`, `sendPhoto`, `sendVideo`, `sendAudio`, `sendDocument`,
and `editMessageText`.

```typescript
// Core proxy logic (simplified)
const SEND_TEXT_METHODS = new Set(["sendMessage"]);
const SEND_FILE_METHODS = new Set([
  "sendPhoto", "sendVideo", "sendAudio", "sendDocument",
]);

function createOutboundProxy(realApi: Api): Api {
  return new Proxy(realApi, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== "function") return original;

      if (SEND_TEXT_METHODS.has(prop as string)) {
        return async (...args: unknown[]) => {
          if (_bypassing) return original.apply(target, args);
          cancelTyping();
          clearPendingTemp();
          // animation promote (text path) ...
          const result = await original.apply(target, args);
          // recordOutgoing ...
          return result;
        };
      }

      if (SEND_FILE_METHODS.has(prop as string)) {
        return async (...args: unknown[]) => {
          if (_bypassing) return original.apply(target, args);
          cancelTyping();
          clearPendingTemp();
          // animation promote (file path) ...
          const result = await original.apply(target, args);
          // recordOutgoing ...
          return result;
        };
      }

      return original; // pass through unintercepted
    },
  });
}
```

The animation interceptor is a pluggable slot — `outbound-proxy.ts`
doesn't import from `animation-state` directly. Instead it exposes
`registerSendInterceptor()` / `clearSendInterceptor()`.

### 2. Changes to `telegram.ts`

`getApi()` returns the proxied instance instead of raw Grammy `Api`.
The proxy is created once (singleton), wrapping the real Api.

```typescript
export function getApi(): Api {
  if (_proxied) return _proxied;
  const raw = getRawApi();  // current logic
  _proxied = createOutboundProxy(raw);
  return _proxied;
}
```

Also expose `getRawApi()` for internal use by the animation system
(needs unproxied access to send its own animation frames).

### 3. Changes to `animation-state.ts`

On `startAnimation()`: register interceptor.
On `cancelAnimation()`: clear interceptor.

The interceptor's `beforeTextSend` promotes the animation (edit → real content).
The interceptor's `beforeFileSend` deletes the placeholder.
The interceptor's `afterFileSend` starts a new animation below.

Uses `getRawApi()` (not `getApi()`) for its own sends — avoids proxy.

### 4. Changes to tools

**Remove all cross-cutting imports.** Each tool file loses:

- `import { cancelTyping } from "../typing-state.js"`
- `import { clearPendingTemp } from "../temp-message.js"`
- `import { recordOutgoing } from "../message-store.js"`
- Any import from `../animation-state.js`

And the corresponding call sites. Tools become pure business logic.

### 5. `sendVoiceDirect()` — one exception

This bypasses Grammy (custom `fetch`). Add two lines:

```typescript
export async function sendVoiceDirect(...) {
  await notifyBeforeFileSend();   // cancel typing + temp + suspend anim
  const result = await fetch(...);
  await notifyAfterFileSend();    // record + resume anim
  return result;
}
```

These are thin wrappers that call the registered interceptor if present.

---

## Re-entrancy Guard

The animation system itself calls `sendMessage` (to create the new
animation placeholder) and `editMessageText` (to cycle frames).
The proxy must not intercept these.

Solution: a boolean flag `_inAnimationSend = true` set inside the
interceptor before it calls the real API. The proxy checks this flag
and passes through when set.

```text
Tool → proxy.sendMessage()
  → interceptor.beforeTextSend()
    → _bypassing = true
    → realApi.editMessageText(...)  // promote animation → real content
    → realApi.sendMessage(...)      // new animation below
    → _bypassing = false
    → return { intercepted, message_id }
```

---

## Memory / Disposal

- **One interceptor at a time.** `registerSendInterceptor` replaces any
  previous one — no accumulation, no leaks.
- **Cleared on cancel.** `cancelAnimation()` calls `clearSendInterceptor()`.
- **Cleared on timeout.** Animation timeout fires `cancelAnimation()`,
  which clears the interceptor.
- **No event listener arrays.** No subscribe/unsubscribe. Just a single
  slot variable (`_interceptor`). Set or null.

---

## Acceptance Criteria

1. Animation message is always the **last** bot message in the chat
2. Text send during animation → edit-in-place, new animation below
3. File send during animation → delete placeholder, send file, new animation
4. Tools have **zero** imports from `animation-state`, `typing-state`,
   `temp-message`, or `message-store` (for recording)
5. No new npm dependencies
6. All existing tests pass after refactor
7. Re-entrancy: animation's own sends don't trigger interception
8. `cancelTyping()` fires automatically on every outbound send
9. `clearPendingTemp()` fires automatically on every outbound send
10. `recordOutgoing()` fires automatically after every outbound send

---

## File Changes Summary

| File | Change |
| --- | --- |
| `src/outbound-proxy.ts` | **New** — proxy factory + interceptor slot |
| `src/telegram.ts` | `getApi()` returns proxied Api; expose `getRawApi()` |
| `src/animation-state.ts` | Register/clear interceptor on start/cancel; use `getRawApi()` |
| `src/tools/send_text.ts` | Remove `cancelTyping`, `clearPendingTemp`, animation imports, `recordOutgoing` |
| `src/tools/notify.ts` | Remove `cancelTyping`, `clearPendingTemp`, animation imports, `recordOutgoing` |
| `src/tools/send_new_checklist.ts` | Remove animation imports, `recordOutgoing` |
| `src/tools/send_file.ts` | Remove `suspendAnimation`, `resumeAnimation`, `cancelTyping`, `clearPendingTemp`, `recordOutgoing` |
| `src/tools/send_text_as_voice.ts` | Remove `suspendAnimation`, `resumeAnimation`, `cancelTyping`, `clearPendingTemp` |
| `src/tools/append_text.ts` | Remove `resetAnimationTimeout`, `recordOutgoingEdit` (edits stay manual) |
| `src/tools/edit_message_text.ts` | Remove `resetAnimationTimeout`, `cancelTyping`, `recordOutgoingEdit` |
| `src/tools/ask.ts` | Remove `cancelTyping`, `clearPendingTemp`, `recordOutgoing` |
| `src/tools/choose.ts` | Remove `cancelTyping`, `clearPendingTemp`, `recordOutgoing` |
| `src/tools/confirm.ts` | Remove `cancelTyping`, `clearPendingTemp`, `recordOutgoing` |
| `src/tools/get_chat.ts` | Remove `recordOutgoing` |
