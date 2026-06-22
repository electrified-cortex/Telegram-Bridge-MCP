---
title: "Review and trim help('start') messaging — too redundant/aggressive"
priority: medium
type: ux-refinement
delegation: curator
dispatch_ready: false
created: 2026-06-21
source: operator-feedback (TG 77758–77760)
related: tmcp-remove-pod-concepts-from-15-0898.md
---

# Review and trim help('start') messaging

## Operator feedback

TG 77758 (2026-06-21): The operator found the session start messaging overly redundant and aggressive in tone, and indicated 7.11.1 would likely be merged but that this area needs a revisit.

## Context

Task 15-0898 added a "Token Save (do this first)" section to the top of `docs/help/start.md` and a "Save your token" section to `docs/help/quick_start.md`. Both sections include explicit file paths and urgency language ("do this first").

The operator finds this redundant (the information exists elsewhere) and aggressive in tone.

Note: this task is **downstream of** `tmcp-remove-pod-concepts-from-15-0898.md` — the pod-concept violations must be fixed first. This task is about tone and redundancy after the content is corrected.

## What to evaluate

1. Is the Token Save section in `help('start')` redundant with content already in `session/start` response or other help topics?
2. Is the "do this first" phrasing too aggressive for a help reference?
3. Should the token-save guidance be in `help('start')` at all, or should `session/start` response handle it?
4. Is `help('quick_start')` the right place for this, or does it conflict with keeping quick_start minimal?

## Acceptance criteria

1. Review `docs/help/start.md` and `docs/help/quick_start.md` against the existing session/start response
2. Redundant content removed or consolidated
3. Tone is informational, not directive/urgent
4. No regression on compaction-survival guidance (the intent of 15-0898 was valid — just the execution and naming were off)
