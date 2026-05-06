---
id: "10-0883"
title: "BUG: TMCP stopped touching activity file after 10-0876+10-0880 merges (regression in release/7.4)"
type: bug
priority: 10
status: closed
created: 2026-05-05
closed: 2026-05-05
filed-by: Curator
delegation: Worker
target_repo: telegram-bridge-mcp
target_branch: release/7.4
verdict: stale-process
---

# Activity-file touch silent after 7.4 merges

## Symptom (Curator-observed 2026-05-05 ~04:37 UTC)

Activity file at `data/activity/10023963829dda4932f6c839a191bfab` last `mtime`-bumped at **04:05:35 UTC**. Operator sent ~10+ messages between 04:05 and 04:37 UTC. Each inbound message should have bumped the mtime per the activity-file design. None did.

TMCP is otherwise healthy:
- `dequeue` returns content (messages flow through long-poll).
- `send` works (Curator's outbound messages render).
- Service messages emit normally.

So the touch-on-inbound-message logic specifically has stopped firing.

## Suspect changes

Today's release/7.4 absorbed:
- `10-0876` cherry-pick (`6423998d` — moved `setDequeueActive(true)` after session_closed guard).
- `b13c025f` 13-fix review batch (12 fixes — security + refactor).
- `10-0880` onboarding-monitor-wiring (changed service message text + help docs).

Most likely regression site: the b13c025f review batch's changes to `src/tools/activity/file-state.ts` (path-traversal split fix, dlog change, phantom absorbedCount removal). Worth bisecting:

1. Check `release/7.4@b13c025f`'s `file-state.ts` vs prior version — did any touch-call get gated incorrectly?
2. Check `nudgeArmed` / `inflightDequeue` state machine — did the 10-0876 reorder leave a path where touch is suppressed?
3. Check whether the `session_closed` early-return guard at line 140 catches the touch invocation site too aggressively.

## Acceptance criteria

1. **First check: is TMCP running latest code?** Operator observed the regression at the same time as recent release/7.4 merges. The running TMCP server may be on a stale build that hasn't restarted. Step one: confirm running TMCP is at `release/7.4@HEAD` (current `b13c025f` or later). If NOT, restart with latest, re-test. If file-touch works post-restart, close as stale-process — not a regression.
2. Repro (post-restart-confirmed): send message to TMCP from Telegram, observe activity file mtime should bump within <2 seconds. Currently does NOT.
3. Diagnose (only if step 1 confirms latest is running): identify the commit that introduced the regression (bisect or code review).
4. Fix: restore touch-on-inbound-message behavior. Cover with regression test.
5. Verify: 10-message manual test, all 10 should bump mtime.

## Out of scope

- Refactoring the activity-file design.
- Changing the debounce window.

## Branch flow

Work directly on `release/7.4` (this is a release-blocker for the 7.4 master merge — operator authorized 7.4 landings). Stage feature branch, run `pnpm test`, DM Curator with diff + repro evidence.

## Bailout

- 90 min cap.
- If the regression is in shared code that affects multiple paths, surface back before broad refactor.

## Priority

P10 — release-blocker for 7.4 ship if file-touch is part of the value proposition. Without it, the activity-file Monitor pattern (just-shipped onboarding feature in 10-0880) doesn't actually fire.
