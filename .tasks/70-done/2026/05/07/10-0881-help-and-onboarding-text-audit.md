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

> Source: operator voice msgs 50386 + 50387, 2026-05-05 (distilled). Onboarding text should emphasize calling dequeue every turn, note that dequeue eventually times out, and point to using a monitor to get back in — without over-explaining. At startup, avoid belaboring `max_wait`: a brief mention that you can probe with `dequeue(token)` or `dequeue(max_wait)` is enough. Too much explanation makes it worse.

> Source: operator voice msgs 50386 + 50387, 2026-05-05 (distilled). The new onboarding-loop startup message feels excessive. It should cover only what the agent needs to stay in the loop, then mention monitoring, then defer to `help` for more — not a large exposition in the service message. A simple "call help" (consistent with the other messages) suffices.

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

## Verification

**Verified:** 2026-05-14
**Verdict:** APPROVED
**Verifier:** Foreman (task-verification sub-agent, fresh-eyes pass)
**Evidence:** AC1 confirmed — `docs/help/start.md` Dequeue Loop section is 6 lines, under 10-line cap, delegates to `help('activity/file')` and `help('dequeue-http')`. AC2 confirmed — `ONBOARDING_LOOP_PATTERN` is 4 non-blank lines, says "dequeue every turn," covers monitor wiring, references `help('start')`. AC3 confirmed — 5 help topics (reactions, presence, modality, dequeue, send) surveyed; all tight, no anti-patterns found. AC4 confirmed — `help.test.ts` uses structural assertions (markers, not verbatim copy).
