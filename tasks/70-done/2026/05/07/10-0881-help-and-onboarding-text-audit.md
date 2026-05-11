---
id: "10-0881"
title: "Audit help/* + onboarding service messages for clarity (compress, drop exposition, use help() refs)"
type: refactor
priority: 20
status: queued
created: 2026-05-05
filed-by: Curator
delegation: Worker
target_repo: telegram-bridge-mcp
target_branch: dev
---

# Help + onboarding text audit

## Operator framing (2026-05-05, msgs 50386 + 50387)

> "It needs to emphasize like DQ on every turn. DQ on every turn. And then say that the DQ will eventually timeout. So use something like a monitor to get back in. That's it. And you don't have to explain. In startup, don't explain the max weight too much. Like you could say, hey, if you want to probe for messages, you can do `dequeue(token)`, or you can do `dequeue(max_wait)`, but that's it. Too much explanation makes it worse."

> "We're adding in this new onboarding loop pattern... There is a startup message that happens. It just seems too excessive. Again, explain what it needs to know to be in the loop, and then talk about monitoring, and then call the help for more. You don't have to make this a large expose in the service message. You can just say 'call help', which is what the other messages say to do."

## Concept

Help blurbs and onboarding service messages are SKILL-like — they tell agents what to do. They've been overgrown with exposition, defaults, and edge-case caveats. Per operator: tighten.

Tight pattern:
- **What to do** (one line, imperative).
- **How to do it** (concrete call shape, one example).
- **`help('<topic>')` for more** (delegate the long form).

## Goal

Audit:
- `docs/help/start.md` (operator specifically critiqued the rewritten Dequeue Loop section from 10-0880).
- `src/service-messages.ts` `ONBOARDING_LOOP_PATTERN` and any other startup messages.
- Other help topics (`help('reactions')`, `help('presence')`, `help('modality')`, etc.) — same audit pass.

For each, rewrite to the tight pattern. Drop:
- max_wait exposition (keep only "long-poll happens, will eventually timeout, then use Monitor").
- Default-explanation paragraphs (defaults don't need explanation; just state defaults).
- "Reference help('foo') for full protocol" gets shorter — just `help('foo')` works.

## Acceptance criteria

- `docs/help/start.md` Dequeue Loop section: <10 lines, ends with "see help(start) for more" or equivalent.
- `ONBOARDING_LOOP_PATTERN` service message: <5 lines. Says "dequeue every turn (token + optional max_wait); if your runtime has a watcher, wire it; help('start') for the full loop."
- Survey 5+ other help topics for same anti-patterns; rewrite if needed.
- Test suite updated (help.test.ts) — assertions on STRUCTURE not on full copy. See 10-0882.

## Worker dispatch optional

Worker may dispatch a GPT-5-class sub-agent review for help-message clarity (operator suggested). Cross-model "is this clear?" pass is the kind of work GPT-5 nails.

## Out of scope

- Renaming kick → nudge (separate task).
- Refactoring service-messages.ts structure.

## Branch flow

Work directly on local `dev`. Stage feature branch, run `pnpm test`, DM Curator with diff. Curator merges to release/7.4 if qualifying as 7.4 polish, else dev only.

## Bailout

- 90 min cap.
- Don't replace operator-mandated phrasings (e.g., "If you are Claude Code, you should also wire up the watcher" — that's locked).

## Related

- 10-0880 (onboarding-monitor-wiring landed; this audit may revise its copy).
- 10-0882 (test-content audit).
- Memory `feedback_telegram_formatting_rules.md`.

## Completion

**Sealed:** 2026-05-07
**Shipped:** PR #168 — TMCP v7.4.1 (squash-merged to master `ab1d4139`)
**Squash commit:** `50607541` (on release/7.4)
**Verdict:** APPROVED
**Sealed by:** Overseer (Worker dispatch)
