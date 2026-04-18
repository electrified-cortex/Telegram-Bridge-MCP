---
name: service-message-content-spec
description: >-
  Defines what each TMCP service message should say, at what compression
  level, and with what help() breadcrumb. Governs the SERVICE_MESSAGES
  constant values in src/service-messages.ts.
---

# Service Message Content Spec

Every service message is an ultra-compressed instruction with a help()
breadcrumb. Not documentation. Not explanation. Orders.

## Principles

1. Ultra-compressed — minimum words to convey the instruction
2. Every hint/nudge ends with `help('<topic>')` pointer
3. No "why" — just what to do
4. No token formula or internal implementation details
5. Bundled as `{ eventType, text }` frozen objects
6. Non-governor sessions: behavioral messages lazy-loaded on first
   operator contact, not on session start

## Message Definitions

### onboarding_token_save

**Event type:** `onboarding_token_save`
**When:** Session start (all sessions)
**Text:** `Save your token to your session memory file.`

No formula. No explanation. The agent either knows how or reads help.

### onboarding_role (governor)

**Event type:** `onboarding_role`
**When:** Session start (governor only)
**Text:** `You are the governor. Ambiguous messages route to you. Forward to the correct session via DM with message ID — recipient calls message/get to read it. help('guide') for routing protocol.`

### onboarding_role (participant)

**Event type:** `session_orientation`
**When:** Session start (non-governor)
**Text:** `You are SID {N}. {Governor label} is your escalation point. Ambiguous messages go to them. help('guide') for routing.`

### onboarding_protocol (reactions/responsiveness)

**Event type:** `onboarding_protocol`
**When:** Governor: session start. Participants: first operator contact.
**Text:** `Show-typing before every reply. For longer work, use animations. Reactions are acknowledgments, not action triggers. Voice messages are auto-saluted on dequeue — add a reaction only to convey meaning beyond receipt. help('reactions') for full protocol.`

### onboarding_buttons

**Event type:** `onboarding_buttons`
**When:** Governor: session start. Participants: first operator contact.
**Text:** `Buttons over typing. confirm/ok, confirm/ok-cancel, confirm/yn for standard prompts. send(type: "question", choose: [...]) for custom options. Free-text ask only when needed. Hybrid (text + audio) for important updates. help('send') for full reference.`

### behavior_nudge_first_message

**Event type:** `behavior_nudge_first_message`
**When:** First operator message received by a session
**Text:** `First operator message. Signal receipt — show-typing or react. help('reactions')`

### behavior_nudge_typing_rate

**Event type:** `behavior_nudge_typing_rate`
**When:** Operator sends message, no show-typing detected
**Text:** `Show-typing after receiving messages. help('send')`

### behavior_nudge_slow_gap

**Event type:** `behavior_nudge_slow_gap`
**When:** Gap detected between receipt and response
**Text:** `Signal activity sooner. help('reactions')`

### behavior_nudge_question_hint

**Event type:** `behavior_nudge_question_hint`
**When:** Agent asks a question without using buttons
**Text:** `Use confirm/yn or choose() for finite-choice questions. help('send')`

### governor_changed

**Event type:** `governor_changed`
**When:** Governor session changes
**Text:** `Governor is now SID {N} ({name}).`

Consolidate all governor change variants (promoted, changed, switched,
no longer) into this single message.

### session_joined

**Event type:** `session_joined`
**When:** New session joins
**Text:** `{Name} (SID {N}) joined. You are the governor — route ambiguous messages.`

### session_closed

**Event type:** `session_closed`
**When:** Session leaves
**Text:** `{Name} (SID {N}) closed.`

### session_closed_new_governor

**Event type:** `session_closed_new_governor`
**When:** Governor closes, new governor assigned
**Text:** `{Name} closed. Governor is now SID {N} ({new_name}).`

## Help Topics Required

The following help topics must exist for breadcrumbs to resolve:

- `help('reactions')` — full reaction protocol (priority queue, voice
  auto-salute, temporary vs permanent, processing preset, DM rules)
- `help('send')` — send tool reference (already exists)
- `help('guide')` — communication guide (already exists)

### help('reactions') Content Requirements

Must cover:

- Reactions are acknowledgments, not action triggers
- Voice messages auto-saluted on dequeue — single-slot replacement
- Processing preset is ideal for audio messages
- Priority queue: only highest visible, lower surfaces on expiry
- Temporary vs permanent: default temporality per emoji
- DMs: no reactions, no typing, no animations — pure data channel
- Single emoji renders as Telegram sticker — use multi-char

## Implementation Notes

- All messages in `src/service-messages.ts` as `Object.freeze({...} as const)`
- Governor messages fire on session start
- Participant behavioral messages fire on first operator contact
  (lazy-load optimization)
- Pin/token formula references: audit and remove all user-facing mentions
