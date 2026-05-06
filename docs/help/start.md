Start — Post-Session Operational Guide

## Profile

If you have a saved profile: action(type: 'profile/load', key: 'YourProfileKey', token)
Restores voice, animation presets, reminders. Skip if no profile exists.

## Dequeue Loop
dequeue(token) IS the loop. Long-poll every cycle.
Default timeout: 5 min. timed_out → call again. empty → block again.
Pattern: drain (max_wait: 0) until empty → block (max_wait: 300) → handle → repeat.
To increase default: action(type: 'profile/dequeue-default', timeout: N, token)
If your runtime supports file watching, create an activity file and watch it. On change, call dequeue(max_wait: 0). help('activity/file') and help('dequeue-http').

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
