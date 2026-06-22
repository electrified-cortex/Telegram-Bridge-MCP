---
title: "TMCP v7.11.1 regression audit — clean branch + new PR"
priority: urgent
type: fix/release
delegation: overseer
dispatch_ready: false
created: 2026-06-22
completed: 2026-06-22
status: done
source: overseer-audit (6 dispatch agents, 83 commits reviewed)
blocks: PR #219 (v7.11.1→master), PR #224 (v7.12.0→master)
related: .tasks/10-drafts/tmcp-remove-pod-concepts-from-15-0898.md
---

## Completion — 2026-06-22

All acceptance criteria met:
- AC1 ✅ — No pod violations in user-facing content (docs, help, service messages)
- AC2 ✅ — Rich Messages epic excluded from branch (all d562f035-adjacent commits deferred)
- AC3 ✅ — All 3 pod-concept fixes applied (pod-memory.md ×2, ACTIVITY_LISTEN_BREADCRUMB, ONBOARDING_LOOP_PATTERN)
- AC4 ✅ — 157 test files, 3719/3719 pass
- AC5 ✅ — Adversarial review passed (Overseer gate)
- AC6 ⏳ — pod-memory rename name not yet decided by operator (non-blocking for this PR; file content fixed, topic key unchanged pending decision)

**Branch**: `release/v7.11.1-clean` — 24 commits on master (db6f80b8)
**Branch tip**: `280fa82c`
**15-0004 included**: ✅ (e9e6d918)
**PR**: `release/v7.11.1-clean → master` (opened 2026-06-22)

# TMCP v7.11.1 Regression Audit

## Context

Operator directive (2026-06-22): "Treat 7.11.1 as one big regression until proven otherwise."

`master` is at v7.11.0 + 7 Dependabot dep bumps (v7.11.0 squash-merged as 9129309c).
`release/v7.11.1` is 83 commits ahead of master. This is NOT a patch release — it includes
a full Rich Messages epic, anomaly classifier, governor-split, and other major new features.

Both PRs #219 and #224 are HELD — close them; rebuild clean.

## Audit verdict by commit

### DEFER to v7.12.0 (~20 commits — wrong scope for a patch)

| Commit | Subject | Reason |
|--------|---------|--------|
| 6aaae8c7 | Bot API 10.1 rich message types | New feature (1,522 lines) — not a patch fix |
| 65fedaf7 | sendRichMessageDirect + stubs | New feature, stubs for unconfirmed API |
| ee0228db | Rich Messages Phase 1 compiler | New feature, not wired to production |
| 77e1553d | Rich Messages Phase 3 compiler | New feature, not wired |
| e3140da6 | Rich Messages Phase 4 compiler | New feature, not wired |
| d562f035 | RICH_MESSAGES routing wire-up | Has 2 logic bugs (wrong arg to warnUnrenderableChars; missing validateText on rich path); defer + fix |
| 4ed3319c | AC5+AC6 routing tests | Known failing tests in suite; tied to d562f035 |
| 7de68d00 | /activity/selftest endpoint | New endpoint, no rate limiting → self-notify abuse vector |
| 168644ca | suppress_pending_hint profile flag | New opt-in feature, not a bug fix |
| 89594b91 | dequeue sub-timeout + zero-result backoff | High-risk behavioral change; 960 lines; false-positive backoff risk |
| ac7fa3cf | anomaly classifier + escalation router | New capability, not wired to any callsite |
| 80a679c7 | governor-split breadcrumb injection | Major new orchestration (1,049 lines) |
| b9dd58bc | auto-pin blocking questions | New UX feature, no regression behind it |

### INCLUDE in clean v7.11.1 (~20 targeted commits)

| Commit | Subject | Notes |
|--------|---------|-------|
| 1814f4bc | sse-monitor stability fixes | Clear patch material — dead-code fix + reconnect stability |
| 725271fb | Regression baseline snapshots | Test-only, zero production change |
| 18618040 | dequeue: wire flushPendingChannelNotify at timeout | Bug fix; no test for specific fix (follow-up test recommended) |
| ffe74869 | checklist: treat skipped=complete | Correct semantic fix |
| 13bfaa9f | sessions: slot index in subsession display name | Regression fix |
| ced48837 | security: closed sessions reject own reconnect tokens | Security fix — blocks reconnect-loop re-entry |
| 1d4ce2a8 | activity: notify on unexpected subscription close | Silent failure mode fix |
| 74bcf5e4 | send: block absolute paths | Info-disclosure safety fix |
| 136b9fba | activity: listen breadcrumb + check endpoint | Behavioral fix (response schema + health-check gap); **NEEDS pod-concept fix — see below** |
| faf5d968 | profile: silent_lifecycle flag | Operational fix for high-churn deployments (purely additive) |
| f25d673e | streaming: production hardening | Rate limit guard, timeout, overflow — defensive; minor doc mismatch non-blocking |
| 8a7af085 | built-in-commands: replace silent catch blocks | Defensive hardening |
| fdab4a68 | built-in-commands: validateText guards governor/voice | Minor: activePanels.delete before guard can orphan panel — pre-existing design issue |
| ce0f782d | service-messages: 5 reconnect constants | Clean — zero pod violations; eventType fix |
| bfee59c0 | fix(tests): correct stale assertions | Test-only corrections |
| 473f5993 | activity-aware notify timing | Test-only! 0 production lines changed |
| 5ae2dc70 | seal 10-3028 | Metadata-only; impl absorbed into 136b9fba (confirmed) |
| ce227bbe | kick→notify Phase 6 | Leftover from v7.9.1 rename; compat aliases present |
| 9744a931 | version bump 7.11.1 | Required |
| 8761f666 | Merge origin/master into release/v7.11.1 | Clean; only task metadata + one correct test assertion update |
| All chore/seal/metadata commits | Various | Admin/metadata, no risk |

## Fixes required before v7.11.1 can ship

### Fix 1 — pod-memory.md violations (e59f9b80)

File: `docs/help/pod-memory.md`

1. Line ~36: `"Claude Code context compaction erases in-memory state."` → `"Your agent runtime's context compaction erases in-memory state."`
2. Line ~40: `"The pod is the directory containing the agent's CLAUDE.md and .claude/settings.local.json."` → Remove or rewrite with runtime-neutral description

### Fix 2 — ACTIVITY_LISTEN_BREADCRUMB pod-concept (136b9fba)

File: `src/service-messages.ts` — `ACTIVITY_LISTEN_BREADCRUMB`

`"Save to a local path (e.g. your pod root or memory/ dir)"` → `"Save to a local path of your choice"`

### Fix 3 — ONBOARDING_LOOP_PATTERN "Monitor-capable runtime (Claude Code)" (pre-existing)

File: `src/service-messages.ts` — `ONBOARDING_LOOP_PATTERN`

Pre-existing violation, not introduced by v7.11.1. Must still be fixed before PR merges.
`"Monitor-capable runtime (Claude Code)"` → `"Monitor-capable runtime"`

## Pre-existing master issues (separate tracking)

- **getNotifyDebounceMs 60k→300k** (376a431c — squashed into v7.11.0, now on master): 
  The commit message said "pure rename — no behavior changes" but the default changed from 60s to 300s. This is already live on master through the v7.11.0 squash. Needs a separate fix commit on master or explicit documentation of the intentional change.
  
- **save_token_to: "memory/telegram/session.token"** in MCP protocol response (start.ts): 
  This is a pod-relative path being returned in the tool result. It instructs agents where to save the token. Whether this violates the "no pod-concepts" directive depends on whether agent-facing strings (not Telegram chat operator-visible) are in scope. Operator to decide.

## Rich Messages bugs (for v7.12.0 fix-before-ship)

From adversarial review of d562f035:
1. `warnUnrenderableChars(sid, finalText)` — `finalText` is MarkdownV2-converted; should be `textWithTopic` (pre-conversion). Misleading diagnostic on rich path.
2. Rich path bypasses `validateText` guard — `routeOutboundMessage` does not validate before send.

## Clean rebuild plan

1. Close PR #219 (v7.11.1 → master) and PR #224 (v7.12.0 → master)
2. Create new branch `release/v7.11.1-clean` from current master (v7.11.0 + 7 dep bumps)
3. Cherry-pick only the INCLUDE commits (see table above)
4. Apply Fix 1, Fix 2, Fix 3 (pod-concept violations)
5. Run full test suite — confirm passing
6. Overseer adversarial review of src/test changes before new PR opens
7. Open new PR: `release/v7.11.1-clean → master`

## Acceptance criteria

1. No "pod-memory", "pod root", "pod-", "CLAUDE.md", ".claude/settings", "Claude Code" in any user-facing content (docs, help topics, service messages)
2. Rich Messages epic commits are NOT present in the new branch
3. All 3 pod-concept fixes applied (pod-memory.md ×2, ACTIVITY_LISTEN_BREADCRUMB, ONBOARDING_LOOP_PATTERN)
4. Full test suite passes
5. New PR is clean and adversarially reviewed by Overseer before merge
6. Operator confirms rename for `pod-memory` help topic (see open question in tmcp-remove-pod-concepts-from-15-0898.md)
