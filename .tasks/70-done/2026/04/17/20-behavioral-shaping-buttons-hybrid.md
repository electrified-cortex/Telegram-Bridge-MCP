# 20 — Behavioral Shaping: Buttons, Hybrid Messages, Question Detection

**Priority:** 20
**Created:** 2026-04-17
**Reporter:** Curator (operator session feedback)

## Problem

Agents are underusing buttons and hybrid messages. The onboarding service messages and agent guide don't emphasize these features enough. Buttons are a core Telegram UX strength that dramatically improves operator experience.

## Requirements

### Button Guidance in Onboarding
- Service messages should teach agents about button presets: OK, OK-Cancel, Y/N
- Emphasize simplicity: most of the time, simple OK or OK-Cancel is the best experience
- Buttons need to stand out in the agent communication guide — not buried

### Intelligent Nudge System (Checklist-Based)

Behavioral nudges should be smart, not spammy. Use a per-session checklist model:

**Question-mark / button nudge:**
- First question with `?` and no buttons → fire a lightweight hint (not blocking)
- Once the agent uses buttons in any form → check off "knows buttons" → never nudge about buttons again in this session
- If agent calls `help('send')` or similar button help → also checks off → no more nudges
- If agent sends 10+ questions without ever using buttons → escalate to a stronger nudge (red flag)
- Open-ended or curiosity questions don't require buttons — the nudge is "consider," not "must"

**General checklist pattern:**
- Each behavioral skill (buttons, reactions, typing, animations) has a session-scoped boolean
- Once demonstrated or help-consulted, the boolean flips and nudges stop
- Conditions can un-check if needed (e.g., extended idle resets some)
- This is behavior tracking integrated into the profile system

### Hybrid Message Promotion
- Agents should know that audio + caption + buttons can all go in one message
- Service messages should promote hybrid messages when appropriate
- Reduce message count by combining related content

### Platform Ownership Principle
- All Telegram communication behavior (reactions, typing, buttons, hybrid messages) should be taught by TMCP via service messages and help docs
- Agent files (CLAUDE.md, startup-context.md) should NOT embed Telegram UX patterns
- If Telegram behavior is found in agent files, that's a yellow flag = TMCP has a behavioral shaping gap

## Acceptance Criteria

- [ ] Onboarding includes button preset guidance (OK, OK-Cancel, Y/N, custom)
- [ ] Question-mark detection nudge implemented
- [ ] Hybrid message guidance in help docs and/or onboarding
- [ ] Agent communication guide prominently features buttons
- [ ] No Telegram UX patterns needed in agent definition files
