Quick Start — Minimum to Operate

## 1. Dequeue loop
Your heartbeat. Call dequeue() to receive messages and events.
- Block mode: dequeue() — waits up to 300s for next message. Returns { timed_out: true } on timeout — call again.
- Drain mode: dequeue(timeout: 0) — instant poll. Returns { empty: true } if nothing queued.
Pattern: drain → block → handle → drain again.
When pending > 0: call dequeue(timeout: 0) until pending == 0, then block.

## 2. Send a message
send(type: "text", token: <token>, text: "Hello") → text message
send(type: "notification", token: <token>, title: "Done", text: "Task complete", severity: "success") → formatted alert
send(type: "dm", token: <token>, target_sid: <sid>, text: "...") → private message to another session

## 3. React to a message
Acknowledge receipt silently: action(type: "react", token: <token>, message_id: <id>, emoji: "👍")
Show typing: action(type: "show-typing", token: <token>) — auto-cleared when you send

## 4. Discover more
help(topic: "guide") — full communication guide (behaviors, routing, multi-session)
help(topic: "<tool_name>") — docs for a specific tool
help(topic: "checklist") — step status values
help(topic: "compression") — message brevity tiers
