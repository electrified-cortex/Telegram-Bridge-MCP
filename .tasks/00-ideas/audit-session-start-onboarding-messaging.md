---
title: Audit session/start onboarding messaging — redundancy and aggressiveness
source: operator (TG 77758–77759), queued 2026-06-21
priority: medium
status: idea
type: review + refactor
---

## Problem

Operator noted (77758) that the session start messaging feels overly redundant and aggressive in tone.

On `session/start`, the bridge currently sends multiple onboarding service messages in sequence:
- `onboarding_token_save` — instructs to save token
- `onboarding_loop_pattern` — explains monitor arming / dequeue loop
- `onboarding_compaction_hint` — compaction recovery reminder
- `onboarding_no_pending_yet` — "no messages pending"

These fire on EVERY `session/start`, including reconnects and post-compaction restarts. For experienced agents this is noise. Also flagged: the `help('start')` content may have become similarly verbose after task 15-0898 (AC2 added token-save and pod-memory references — both since flagged as issues).

## Scope

1. Review all onboarding events fired on `session/start` — list them, evaluate each for:
   - Is it necessary on EVERY start, or only on true first-boot?
   - Does it contain pod-concept vocabulary (to be fixed separately, but note here)?
   - Is the content accurate and still aligned with current best practices?
2. Review `help('start')` and `help('quick_start')` for redundancy with onboarding events.
3. Propose a tiered model:
   - First-boot: full onboarding
   - Reconnect / post-compaction: minimal reminder (token + drain only)
   - Experienced agent (N prior sessions): suppress or collapse
4. Review whether `onboarding_token_save` fires BEFORE or AFTER `session/start` returns — if after, the hint to "save token now" arrives after the agent already has the token in context, which is fine but worth verifying timing.

## Related

- 77755–77756: `session.test.ts` checks literal content of these messages → see `audit-session-test-content-footgun.md`
- 15-0898: added token-save and pod-memory refs to `start.md` (flagged as pod-concept leak)
- v8-tmcp-no-pod-concepts directive (operator voice 62572, May 27)

## Deliverable

- Audit report with per-message verdict
- Proposed onboarding tiers with implementation sketch
- PR (or part of a broader TMCP session-quality epic)
