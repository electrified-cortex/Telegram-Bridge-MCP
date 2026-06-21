Start — Post-Session Operational Guide

## Token Save (do this first)
Write your session token to `memory/telegram/session.token` as a plain integer — no JSON, no quotes. This path survives compaction. See `help('pod-memory')` for the convention.

## Profile

If you have a saved profile: action(type: 'profile/load', key: 'YourProfileKey', token)
Restores voice, animation presets, reminders. Skip if no profile exists.

## Dequeue Loop
dequeue(token) IS the loop. Long-poll every cycle.
Default timeout: 5 min. timed_out → call again. empty → block again.
Pattern: dequeue() → handle → dequeue() immediately → repeat until timed_out: true. After any send, call dequeue() again immediately.
To increase default: action(type: 'profile/dequeue-default', timeout: N, token)
**Wake monitor — pick one:**
1. **HTTP mode (preferred):** `action(type: 'activity/listen')` → arm `Monitor(command: <returned command>, persistent: true)`. See help('activity/listen').
2. **File watcher (fallback):** `action(type: 'activity/file/create')` → arm Monitor on returned path. See help('activity/file').
3. **No Monitor:** long-poll `dequeue(max_wait: 300)` every turn — always sufficient.

## Send Basics
send(type: 'text', token, text: 'Hello') → text message
send(type: 'notification', token, title: 'Done', text: 'Task complete', severity: 'success') → formatted alert

## DM Pattern
send(type: 'dm', token, target: 2, text: '...') → private
message to another session (target is numeric SID)
action(type: 'react', token, message_id: <id>, emoji: '👍') → silent receipt ack

## Help
All tools: help(). Specific tool: help('tool_name'). Full guide: help('guide').
help('guide') → full comms guide (optional reference, not required reading)
help('dequeue') → dequeue loop rules · help('compression') → message brevity tiers

## Quick reference
- Buttons/keyboards: help('send')
- Animations, checklists, progress bars: help('action')
- Multi-session routing and DMs: help('guide')
- Full operational guide: help('guide')
