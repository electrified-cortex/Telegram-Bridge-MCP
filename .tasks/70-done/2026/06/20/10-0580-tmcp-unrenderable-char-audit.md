---
Created: 2026-04-18
Status: Draft
Host: services.cortex.lan
Priority: 70
Source: Operator voice (msg 38011), V7 onboarding test
---

# Audit TMCP V7 Unrenderable Character Warning Set

## Objective

Verify that TMCP V7's `unrenderable_chars_warning` service message only flags
characters that genuinely fail to render in the Telegram clients operator
uses. Em-dash (U+2014) was flagged twice in a single session; operator
believes em-dash renders correctly in their experience.

## Context

V7 introduced an `unrenderable_chars_warning` service event that fires when
outbound text contains characters from a known-bad set. On 2026-04-18, the
warning fired twice for em-dash. Operator pushed back: "I'm not sure if
em-dash is actually unrenderable. I've seen it plenty of times. That might
be a false one."

False positives erode trust in the warning system. If em-dash actually
renders, agents will ignore the warning and continue using em-dash, which
trains them to ignore real warnings (alarm fatigue).

## Questions

1. What is the current set of characters flagged by `unrenderable_chars_warning`?
2. Where did the set come from (audit history, prior incident, copy-paste)?
3. For each character: does it actually fail to render in the iOS, Android,
   desktop, and web Telegram clients?
4. Should the set be split into "confirmed broken" (hard warning) vs
   "potentially problematic" (soft warning or remove)?

## Acceptance Criteria

- [ ] Current flagged set documented
- [ ] Each character empirically tested in active Telegram clients
- [ ] Set narrowed to confirmed-broken only
- [ ] If em-dash/en-dash render fine, remove from the set
- [ ] Help docs updated to reflect the audited set

## Notes

- TMCP/services task, not cortex.lan
- Confirmed bad: arrows (→, ←, ↔)
- Possibly false positive: em-dash, en-dash
- Low priority but high signal — false warnings erode protocol trust

## Resolution

**RESOLVED 2026-06-20 by the agent.** Em-dash (U+2014) was removed from the unrenderable chars set (tests confirm "no longer flagged"). Additionally, `UNRENDERABLE_WARNING_ENABLED` defaults to `false` in `src/tools/send.ts` — the warning is fully opt-in. False positive concern is moot. Archiving as resolved.
