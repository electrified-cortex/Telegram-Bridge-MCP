---
created: 2026-06-10
status: draft
priority: 20
source: Directive (Telegram msgs 71016/71025/71028/71032/71034)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Chore
agent_type: Worker
model_class: sonnet-class
reasoning_effort: medium
relates: 10-drafts/notification-wake-contract-SPEC.md (7.10 notification work)
target_version: 7.9.1
---

## Rationale

"Kick" is misleading — it reads as "kick a participant out of the chat" / "dump them." Replace it **everywhere** it appears in the code/API/docs. "Kick" is casual-use-only. Align official naming to S-IM, which uses **`notify`** (`{type:'notify', pending:N}`).

## Scope (measured 2026-06-10)
- **363** total "kick" occurrences in `src/**.ts` (**188** non-test, 175 in tests).
- Heaviest files: `src/tools/activity/file-state.ts` (68), `src/tools/profile/kick-lockout.ts` (25), `src/reminder-state.ts` (21), `src/session-queue.ts` (17), `src/tools/dequeue.ts` (14), `src/session-manager.ts` (14), `src/tools/action.ts` (7), `src/sse-endpoint.ts` (5)…
- **6+ docs/help** files mention kick (`docs/help/activity/file.md`, `.../listen.md`, `channels.md`, `compacted.md`, `events.md`, `profile/kick-lockout.md`).

## Replacement scheme (CONFIRM verb with operator)
- Proposed: **kick → notify** (the wake/notification action). e.g. `kickSseSubscriber`→`notifySseSubscriber`, `kickIfAllowed`→`notifyIfAllowed`, `profile/kick-lockout`→`profile/notify-lockout`, "kick the agent"→"notify the agent".
- Public API paths (`profile/kick-lockout`, `profile/kick-debounce`) are ALREADY shipped (7.8.3) → keep **deprecated aliases** pointing to the new names (same pattern as kick-debounce→kick-lockout). Zero breakage.
- (Optional) reconsider "lockout" too if "lock" confuses → e.g. "cooldown".

## Plan
Spec → delegate to foreman/worker → full test + doc update → CI verify green. Part of the broader "unify how notifications appear" (consistent across TMCP + S-IM) for 7.10.

## Timing — 7.9.1
7.9.0 ships as-is (CI green). This rename = **7.9.1** patch fix. Replacement verb **notify** locked.

## Acceptance Criteria

- [ ] All 188 non-test `kick` occurrences renamed to `notify` equivalents (grep `src/**/*.ts` excluding tests → 0 remaining non-deprecated `kick` references)
- [ ] All 175 test occurrences updated to match new names
- [ ] `profile/kick-lockout` deprecated alias retained → routes to `profile/notify-lockout`
- [ ] `profile/kick-debounce` deprecated alias retained → routes to `profile/notify-debounce`
- [ ] All 6+ docs/help files (`activity/file.md`, `listen.md`, `channels.md`, `compacted.md`, `events.md`, `profile/kick-lockout.md`) updated to use `notify` terminology
- [ ] `pnpm test` passes (all tests green)
- [ ] `tsc --noEmit` passes
- [ ] No breaking changes to external callers — deprecated aliases preserve backward compat

## Scope boundary

- Source rename only: `src/` TypeScript files + docs/help markdown
- Does NOT rename casual operator-Curator usage in skills or task files
- Does NOT resolve the "lockout" → "cooldown" question (that is optional/separate)
- Does NOT change functional behavior — rename only

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-20
- Verdict: PASS — naming confirmed by operator ("notify" locked). ACs binary (grep count + test pass + tsc). Scope: pure rename, no behavior change. Deprecated aliases specified. Delegation correct. No blocking open questions ("lockout"/"cooldown" is explicitly optional/separate). PASS.


---
> ⚠️ **AUDIT 2026-06-26:** Substantially SHIPPED (kick→notify; tracked done as 10-2302, v7.9.1). 'kick' count down from 363 to ~42 — mostly intentional deprecated aliases + code comments. Residual = comment-only cleanup; consider closing.
