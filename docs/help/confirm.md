Confirm — Interactive confirmation prompts with inline buttons.

Routes:
- confirm/ok — single OK button (acknowledgment/CTA)
- confirm/ok-cancel — OK + Cancel (destructive action gate)
- confirm/yn — Yes/No (binary decision)

action(type: "confirm") — lists sub-paths in live API.

All variants block until button pressed, timeout, or text/voice reply (skipped).
Drain pending messages before calling: dequeue(token: ..., max_wait: 0)

## Choosing variant
- confirm/ok: acknowledgments, "tap to continue" CTAs
- confirm/ok-cancel: destructive actions, multi-step confirmations
- confirm/yn: yes/no questions, binary choices

## Result forms
{ confirmed: true/false } — button pressed
{ timed_out: true }       — no response within timeout
{ skipped: true, text_response: "..." } — user typed/spoke instead

Related: acknowledge, react, message/edit
