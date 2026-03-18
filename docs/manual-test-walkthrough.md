# Manual Test Walkthrough

Live test plan executed by the overseer agent while the operator observes on Telegram. Each scenario is a self-contained test with expected outcome.

## Setup

1. Build, lint, and run full test suite
2. Restart the MCP server (fresh state)
3. Create a Telegram topic for test output
4. Agent executes each scenario and reports pass/fail

---

## Scenario 1 — Session Basics

### 1.1 Session Identity

- Call `list_sessions`
- Verify: response includes this session (SID 1, name "Primary")
- Verify: `sessions_active: 1`

### 1.2 Bot Info

- Call `get_me`
- Verify: response includes bot username, MCP version, build info

### 1.3 Topic Label

- Call `set_topic` with topic "🧪 Test"
- Send a message
- Verify: message has `**[🧪 Test]**` prefix in Telegram
- Clear topic (empty string)
- Send another message
- Verify: no prefix

---

## Scenario 2 — Messaging

### 2.1 Send Text

- `send_text` with a short message
- Verify: appears in Telegram chat

### 2.2 Send with Keyboard

- `send_message` with inline keyboard (2 buttons)
- Verify: message appears with buttons
- Operator presses a button
- Verify: callback received via `dequeue_update`

### 2.3 Notify

- `notify` with severity "info" and a status message
- Verify: notification appears in chat

### 2.4 Edit Message

- `send_text` a message, capture message_id
- `edit_message_text` to change the content
- Verify: message updated in Telegram

### 2.5 Append Text

- `send_text` a message, capture message_id
- `append_text` to add content
- Verify: message now has both original + appended text

### 2.6 Delete Message

- `send_text` a throwaway message, capture message_id
- `delete_message` to remove it
- Verify: message gone from chat

### 2.7 Pin Message

- `send_text` a message, capture message_id
- `pin_message`
- Verify: message is pinned in chat

---

## Scenario 3 — Interactive Tools

### 3.1 Confirm (Yes/No)

- `confirm` with a test question
- Operator presses Yes
- Verify: tool returns confirmed=true

### 3.2 Confirm (Deny)

- `confirm` with a test question
- Operator presses No
- Verify: tool returns confirmed=false

### 3.3 Choose (Single Selection)

- `choose` with 3 options
- Operator selects one
- Verify: tool returns the selected value

### 3.4 Ask (Open-Ended)

- `ask` with a question
- Operator types a response
- Verify: tool returns the operator's text

### 3.5 Choice Buttons (Non-Blocking)

- `send_choice` with options
- Operator presses one
- Verify: callback received via `dequeue_update`

---

## Scenario 4 — Animations and Typing

### 4.1 Show Animation

- `show_animation` with preset "thinking"
- Verify: animated message appears
- Wait 3 seconds
- `cancel_animation`
- Verify: animation stops, message remains as static text

### 4.2 Show Typing

- `show_typing`
- Verify: typing indicator appears briefly

### 4.3 Default Animation

- `set_default_animation` with a preset
- `show_animation` (no preset — uses default)
- Verify: default animation plays
- `cancel_animation`

---

## Scenario 5 — Reactions

### 5.1 Set Reaction

- `send_text` a message, capture message_id
- Operator sends a reply
- Agent uses `set_reaction` with an emoji on the operator's message
- Verify: reaction appears on the message

---

## Scenario 6 — Checklist and Progress

### 6.1 Checklist

- `send_new_checklist` with 3 items (all unchecked)
- Verify: checklist message appears
- `update_checklist` — mark item 1 done
- Verify: item 1 shows checked
- `update_checklist` — mark all done
- Verify: all items checked

### 6.2 Progress Bar

- `send_new_progress` with label and 0%
- Verify: progress bar appears
- `update_progress` to 50%
- Verify: bar updates
- `update_progress` to 100%
- Verify: bar shows complete

---

## Scenario 7 — Message Inspection

### 7.1 Get Message

- `send_text` a message, capture message_id
- `get_message` with that ID
- Verify: returns message content, date, chat info

### 7.2 Get Chat

- `get_chat`
- Verify: returns chat title, type, ID

---

## Scenario 8 — Debug and Diagnostics

### 8.1 Debug Log

- `get_debug_log`
- Verify: returns recent debug entries (routing, session events)

### 8.2 Session Recording

- `dump_session_record`
- Verify: returns timeline of events for this session

---

## Scenario 9 — Reply-To Routing (Single Session)

### 9.1 Reply Targeting

- Agent sends a message via `send_text`
- Operator replies to it
- Agent calls `dequeue_update`
- Verify: the reply is received with `reply_to` metadata pointing to the original message

### 9.2 Callback Targeting

- Agent sends `confirm` prompt
- Operator presses button
- Verify: callback is received by the same session that sent the prompt

---

## Scenario 10 — Edge Cases

### 10.1 Rapid Messages

- Operator sends 5 messages quickly
- Agent calls `dequeue_update`
- Verify: all 5 received, no drops, correct order

### 10.2 Voice Message (if available)

- Operator sends a voice message
- Agent calls `dequeue_update`
- Verify: voice event received with transcription (if configured)
- Verify: 🫡 reaction set on the voice message

### 10.3 Slash Commands

- `set_commands` to register a `/test` command
- Operator sends `/test`
- Agent calls `dequeue_update`
- Verify: command received as a message event
