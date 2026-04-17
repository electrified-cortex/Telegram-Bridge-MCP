# 10 — Service Message Content Spec

## Summary

Write a spec defining the content, structure, and compression level for
every TMCP service message. This spec governs what each message says and
why. Implementation follows after spec approval.

## Context

Operator reviewed all service messages in PR #141 (constants refactor)
and provided detailed feedback. Key principles:

1. **Ultra compressed** — orders, not textbooks. Apply compression
   principles inline in TypeScript.
2. **Every message ends with help() breadcrumb** — "help('topic') for
   more" on all hints and nudges.
3. **Bundle event type + text** — single frozen object per message,
   not separate maps. Use `Object.freeze` + `as const`.
4. **Audit for "pin" references** — remove all user-facing mentions.
   The pin concept is internal implementation detail.

## Operator Feedback Per Message

### onboarding_token_save
- Current: verbose explanation of token formula
- Target: "Save your token to your session memory file."
- No formula, no sid/pin explanation

### onboarding_protocol (reactions/responsiveness)
- Needs full redesign as a reaction-focused message
- Voice messages arrive pre-saluted (auto 🫡 on dequeue)
- Salute = strongest acknowledgment — explain this
- Agent can weaken by replacing with different reaction
- Processing preset = ideal for audio messages
- Priority levels: temporary vs permanent, timeouts
- Ends with help('reactions') pointer
- Must be ultra compressed

### onboarding_role (governor)
- Add forwarding protocol: governor reads ambiguous messages,
  forwards to correct session via DM with message ID
- Target session uses message/get to read the forwarded message
- Governor routes, doesn't relay content

### onboarding_buttons
- Hybrid message mention should be optional, not default
- Buttons are the focus — hybrid is a "you can also" footnote

### behavior_nudge_* (all nudges)
- Every nudge hint must end with help() pointer
- Keep extremely short — one sentence + help pointer
- Ultra compressed

### Governor change messages
- Deduplicate: "no longer governor", "governor changed",
  "governor switched" → consolidate into single clear message
- Show SID + name label in session references

### DM protocol (new message needed)
- DMs are pure data channel
- No reactions, no typing, no animations in response to DMs
- Reply over DM only — nothing goes to main chat
- Should be part of the multi-session onboarding

### Single emoji warning (new or part of reactions message)
- Single emoji in a text message renders as Telegram sticker
- Warn agents to use multi-character content for status messages

## Acceptance Criteria

- [ ] Spec written with exact target text for each message
- [ ] All messages ultra compressed
- [ ] All messages end with help() breadcrumb where appropriate
- [ ] Bundled event type + text structure specified
- [ ] Object.freeze + as const pattern specified
- [ ] Pin audit: all user-facing references identified for removal
- [ ] DM protocol message specified
- [ ] Single emoji sticker warning included

## Dependencies

- PR #141 (constants refactor) should merge first for structure
- This spec governs content rewrites as a follow-up PR

## Ownership

Curator writes the spec. Workers implement after approval.
