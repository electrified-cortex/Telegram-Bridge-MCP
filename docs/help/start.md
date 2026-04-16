Start — Post-Session Operational Guide

## Profile
If you have a saved profile: action(type: 'profile/load', key: 'YourProfileKey', token)
Restores voice, animation presets, reminders. Skip if no profile exists.

## Dequeue Loop
Call dequeue() with no parameters. Default timeout is 5 minutes. This is intentional — blocking reduces token use.
Returns { timed_out: true } on timeout → call again. Returns { empty: true } on instant poll.
Pattern: drain → block → handle → drain again. When pending > 0: dequeue(timeout: 0) until pending == 0, then block.
Claude Code sessions (long-lived): action(type: 'profile/dequeue-default', timeout: N, token) to increase timeout.

## Send Basics
send(type: 'text', token, text: 'Hello') → text message
send(type: 'notification', token, title: 'Done', text: 'Task complete', severity: 'success') → formatted alert

## DM Pattern
send(type: 'dm', token, target: 'SessionName', text: '...') → private message to another session
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
