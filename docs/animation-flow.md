# Animation System — Message Flow

```mermaid
sequenceDiagram
    participant Agent
    participant Proxy as Outbound Proxy
    participant Intercept as SendInterceptor
    participant Api as Telegram API
    participant Store as Message Store

    Note over Agent,Store: 1. Agent starts animation
    Agent->>Api: show_animation → sendMessage (bypasses proxy)
    Api-->>Agent: message_id: 100 (animation placeholder)
    Agent->>Intercept: registerSendInterceptor(callbacks)

    Note over Agent,Store: 2. Agent sends text (normal promotion)
    Agent->>Proxy: sendMessage("Hello")
    Proxy->>Proxy: cancelTyping, clearPendingTemp
    Proxy->>Intercept: beforeTextSend(chatId, "Hello", opts)
    Intercept->>Api: editMessageText(100, "Hello") [bypassed]
    Note right of Api: Animation msg 100 → "Hello"
    Intercept->>Api: sendMessage(new animation) [bypassed]
    Note right of Api: New animation msg 101
    Intercept-->>Proxy: { intercepted: true, message_id: 100 }
    Proxy->>Store: recordOutgoing(100, "text", "Hello")
    Proxy-->>Agent: { message_id: 100 }

    Note over Agent,Store: 3. Agent sends buttons (skip promotion)
    Agent->>Proxy: sendMessage("Pick one", {reply_markup: ...})
    Proxy->>Proxy: cancelTyping, clearPendingTemp
    Proxy->>Intercept: beforeTextSend(chatId, text, opts)
    Note right of Intercept: opts has reply_markup → return false
    Intercept-->>Proxy: { intercepted: false }
    Proxy->>Api: sendMessage("Pick one", {reply_markup})
    Api-->>Proxy: message_id: 102
    Proxy->>Store: recordOutgoing(102, "text")
    Note right of Api: Animation 101 stays, buttons at 102

    Note over Agent,Store: 4. Agent sends file (suspend/resume)
    Agent->>Proxy: sendPhoto(chatId, file)
    Proxy->>Intercept: beforeFileSend()
    Intercept->>Api: deleteMessage(101) [bypassed]
    Proxy->>Api: sendPhoto(chatId, file)
    Api-->>Proxy: message_id: 103
    Proxy->>Store: recordOutgoing(103, "photo")
    Proxy->>Intercept: afterFileSend()
    Intercept->>Api: sendMessage(new animation) [bypassed]
    Note right of Api: New animation msg 104

    Note over Agent,Store: 5. Agent cancels with text
    Agent->>Intercept: cancelAnimation("Done!")
    Intercept->>Intercept: clearTimers, clearSendInterceptor
    Intercept->>Api: editMessageText(104, "Done!") [bypassed]
    Intercept->>Store: recordOutgoing(104, "text", "Done!")
    Note right of Api: Animation 104 → "Done!" (permanent)
```

## Recording rationale

`recordOutgoing` is called whenever a message becomes permanent content:

| Scenario | Who records | When |
|---|---|---|
| Text send (promoted) | Outbound proxy | After interceptor returns `intercepted: true` |
| Text send (normal) | Outbound proxy | After `sendMessage` returns |
| File send | Outbound proxy | After API call returns |
| Cancel with text | `cancelAnimation()` | After editing animation → permanent text |
| Voice send | `sendVoiceDirect` | Via `notifyAfterFileSend()` manual hook |

The cancel-with-text recording (fix #3) was previously missing — the animation got edited to permanent text but the message store didn't know about it.
