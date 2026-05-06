---
id: "10-0878"
title: "Remove robot emoji 🤖 from default name tag across all production surfaces"
type: polish
priority: 10
status: draft
created: 2026-05-05
filed-by: Curator
delegation: Worker
target_repo: telegram-bridge-mcp
---

# Strip 🤖 from default name tagging surfaces

## Operator framing (2026-05-05)

> "We should go ahead and remove the robot emoji from the default name tagging. We don't need it anymore. It's considered emoji fatigue."

10-0869 already removed `🤖` from the *auto-default* name tag (now `<color> <name>`). Confirmed: my session came online with `🟦 Curator`, no robot. But `🤖` is still hardcoded into many *other* TMCP-generated messages — surfaces where the operator can't have set a custom name tag yet (e.g. session-online announce fires before profile/load). Sweep these.

## Surfaces to update (audit done 2026-05-05)

1. **Outbound multi-session header** — `src/outbound-proxy.ts:246` injects `🤖 Name` prefix on every bot message when 2+ sessions active. New format: `<color> <name>` (no robot).
2. **Session approval dialog** — `src/tools/session/start.ts:76` (`🤖 *${label}* ${name}` approve/deny prompt).
3. **Session denied reply** — `src/tools/session/start.ts:154` (`🤖 *Session denied:* ${name}`).
4. **Session reconnect dialog** — `src/tools/session/start.ts:168` (`🤖 *Session reconnecting:* ${name}`).
5. **Session reconnect denied** — `src/tools/session/start.ts:206` (`🤖 *Session reconnect denied:* ${name}`).
6. **Session online announce (pinned)** — `src/tools/session/start.ts:315` (`${color} 🤖 \`${name}\`\nSession ${sid} — 🟢 Online`). Operator note: profile not loaded at this point, so custom name tag wouldn't be visible — strip robot from the auto-default.
7. **Session disconnect notice** — `src/session-teardown.ts:79` (`🤖 ${name} has disconnected`).
8. **Governor promotion notice** — `src/session-teardown.ts:132` (`⚠️ Governor session closed. 🤖 ${label} promoted to governor`).
9. **`/sessions` command (active sessions header)** — `src/built-in-commands.ts:1283` (`🤖 Active sessions:`).
10. **Comment in `start.ts:347`** — references the old format; update to reflect new format.

Replacement convention: where the line currently reads `🤖 ${name}` or `🤖 *${label}*`, drop the `🤖 ` (and the trailing space). Where `${color} 🤖 ${name}` appears, drop `🤖 ` so it becomes `${color} ${name}`.

## Acceptance criteria

- All 9 production surfaces above no longer emit `🤖`.
- Tests are updated:
  - `src/animation-state.test.ts:366,373` — header mock and assertion updated to new no-robot format.
  - `src/startup-token-cleanup.test.ts:63,72,73` — pinned-message fixtures updated to new format.
  - `src/session-manager.test.ts:655` — already asserts no robot; keep but extend to multi-session header path if not already covered.
  - `src/tools/session/close.test.ts` — disconnect-notice assertions (lines 395, 405, 415, 549) updated.
  - `src/tools/session/start.test.ts:711` and `rename.test.ts:130` — these test that `🤖` *in user input* is rejected; KEEP unchanged (input validation, not output format).
- `pnpm test` passes 100%.
- A grep for `🤖` in `src/` returns only:
  - The two input-rejection tests (`start.test.ts:711`, `rename.test.ts:130`).
  - The negative assertions (`session-manager.test.ts:655`).
- Docs sweep (separate or same task — flag for operator):
  - `docs/multi-session-protocol.md`, `docs/multi-session-flow.md`, `docs/multi-session.md`, `docs/help/guide.md` — examples should reflect new format. SKILLs at `skills/telegram-mcp-session-startup/SKILL.md:74` references the old format.
- Changelogs untouched (history).

## Out of scope

- Custom name tags themselves (10-0869 owns that).
- Rejecting `🤖` from user-supplied custom name tags — that's existing behavior, keep as-is.
- Server emoji indicator that Telegram itself renders for bots (out of TMCP control).

## Branch / PR flow

Per TMCP convention: feature branch local, merge into `release/7.4` locally. Confirm with Curator before push (only `release/7.4 -> master` is a public PR).

## Bailout

- Stop and ask if test-update scope explodes beyond the 5 test files listed above — that signals a hidden surface.
- 90 min implementation cap; if exceeded, summarize progress and surface blocker.

## Related

- 10-0869 (custom name tags — landed; default-auto stripped robot).
- 7.4 release stack — could land in 7.4.1 if Worker is fast post-rehydration.

## Completion

- Branch: `10-0878` merged into `release/7.4` (local, per TMCP convention)
- Merge commit: `2ddd78d8` on release/7.4; feature commit `f60231e6`
- 9 production surfaces stripped: multi-session header, session approval/denied/reconnect dialogs, online announce, disconnect notice, governor promotion, /sessions command
- 5 test files updated (output assertions): animation-state.test.ts, startup-token-cleanup.test.ts, tools/session/close.test.ts + others
- Input-rejection tests untouched (start.test.ts:711, rename.test.ts:130) — by design
- Tests: pnpm test — 2955 passed, 0 failed
- Worker: Copilot Worker (SID 2)

## Verification Stamp

**Verdict:** APPROVED
**Date:** 2026-05-05
**Criteria:** 9/9 passed
**Evidence:** All 9 production surfaces verified robot-free on release/7.4. Robot emoji (`🤖`) found only in 4 expected negative-assertion test locations. Merge commit `2ddd78d8` confirmed on release/7.4. 5 output-assertion test files updated; 2 input-rejection tests preserved unchanged. 2955 tests green.
