---
title: Replace "kick" → "notify" everywhere (misleading term) — notification unification
filed: 2026-06-10
source: operator directive (Telegram, msgs 71016/71025/71028/71032/71034)
relates: tasks/10-drafts/notification-wake-contract-SPEC.md (7.10 notification work)
status: draft / needs spec + naming confirm
target: 7.9.1 (operator: patch fix post-7.9.0; kick-lockout already public in 7.8.3 → deprecation aliases needed regardless)
---

## Directive (operator)
"Kick" is misleading — it reads as "kick a participant out of the chat" / "dump them." Replace it **everywhere** it appears in the code/API/docs. "Kick" is casual-use-only between operator and Curator. Align official naming to S-IM, which uses **`notify`** (`{type:'notify', pending:N}`).

## Scope (measured 2026-06-10)
- **363** total "kick" occurrences in `src/**.ts` (**188** non-test, 175 in tests).
- Heaviest files: `src/tools/activity/file-state.ts` (68), `src/tools/profile/kick-lockout.ts` (25), `src/reminder-state.ts` (21), `src/session-queue.ts` (17), `src/tools/dequeue.ts` (14), `src/session-manager.ts` (14), `src/tools/action.ts` (7), `src/sse-endpoint.ts` (5)…
- **6+ docs/help** files mention kick (`docs/help/activity/file.md`, `.../listen.md`, `channels.md`, `compacted.md`, `events.md`, `profile/kick-lockout.md`).

## Replacement scheme (CONFIRM verb with operator)
- Proposed: **kick → notify** (the wake/notification action). e.g. `kickSseSubscriber`→`notifySseSubscriber`, `kickIfAllowed`→`notifyIfAllowed`, `profile/kick-lockout`→`profile/notify-lockout`, "kick the agent"→"notify the agent".
- Public API paths (`profile/kick-lockout`, `profile/kick-debounce`) are ALREADY shipped (7.8.3) → keep **deprecated aliases** pointing to the new names (same pattern as kick-debounce→kick-lockout). Zero breakage.
- (Optional, operator raised) reconsider "lockout" too if "lock" confuses → e.g. "cooldown".

## Plan
Spec → delegate to foreman/worker → full test + doc update → CI verify green. Part of the broader "unify how notifications appear" (consistent across TMCP + S-IM) for 7.10.

## Timing — 7.9.1
7.9.0 ships as-is (CI green). This rename = **7.9.1** patch fix (operator: "make this a 7.9.1 fix"). Replacement verb **notify** locked.
