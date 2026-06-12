---
type: spec
status: draft
filed-by: Curator
date: 2026-05-23
origin: operator voice 2026-05-23 (Zhu-Li restart noise); promoted from 00-ideas/silent-lifecycle-mode-2026-05-23.md
owner: Curator -> Overseer -> TMCP worker
---

# TMCP: `profile/silent-lifecycle` — suppress per-profile session start/close announcements

## Problem

Every TMCP session emits two operator-visible announcements over its lifetime: a "session joined" message when a new session is approved/started, and a "session closed" message when it ends. For low-churn pods (Curator, Overseer, BT) this is useful presence signal. For high-churn pods — containerized assistants under `restart: unless-stopped` (Zhu-Li today; future worker spawns and test rigs) — every restart cycle adds a join/close pair to the chat. Over hours this becomes a noise floor that buries real messages and demands operator attention for events the operator does not care about. There is no current per-pod opt-out: announcements are unconditional.

## Behavior

A new profile-level boolean `silent_lifecycle` (default `false`) governs whether session start and session close emit their public operator-facing chat announcements for sessions loaded under that profile. When `silent_lifecycle: true`:

- The session/start public announcement (the "new/reconnecting session" / "session joined" chat post, including any pinned approval-result message) is **suppressed**. Internal session state — sid allocation, color assignment, governor notification for routing, queue creation, activity-file lifecycle — proceeds unchanged.
- The session/close public announcement (the "✅ Session closed: <name> (SID <n>)" chat post emitted on graceful close) is **suppressed**. Internal close mechanics — queue teardown, callback-hook replacement, sid release — proceed unchanged.
- **Not suppressed:** approval-prompt dialogs (operator must still approve a new session interactively unless auto-approve is consumed), explicit `send` posts by the agent, reactions, error/service-message broadcasts unrelated to lifecycle, governor refresh, debug logs, dequeue-side `session_closed` signals to other sessions.
- Default is `false` so existing pods (Curator, Overseer, BT) behave identically post-deploy. Opt-in per profile.

The setting is read at the moment of emission (start-time and close-time) from the active session's profile, so toggling mid-session takes effect on next close.

## Config surface

Following the existing `profile/<kebab-noun>` convention (`profile/voice`, `profile/topic`, `profile/kick-lockout`, `profile/dequeue-default`):

- New action: `action(type: 'profile/silent-lifecycle', enabled: boolean)`
  - GET form: `enabled` omitted -> returns `{ ok: true, enabled: <current>, default: false }`.
  - SET form: `enabled: true | false` -> persists to the current session's profile, returns `{ ok: true, enabled, previous }`.
- New persisted profile key: `silent_lifecycle: boolean` in profile save/load/import payloads (additive, optional, defaults to `false` when absent for backward compatibility with existing saved profiles).
- Honored by both `session/start` (initial connect AND reconnect paths) and `session/close` (graceful close path).

## Acceptance criteria

1. A profile saved with `silent_lifecycle: true` and then loaded by a session causes that session's start and close events to produce **zero** operator-visible chat messages tied to lifecycle (no join post, no close post, no pinned announcement). Verified by chat transcript inspection across a connect/disconnect cycle.
2. A profile with `silent_lifecycle: false` (or with the field absent) behaves identically to today's behavior — join and close announcements both appear. Verified by regression against existing snapshot/integration tests.
3. With `silent_lifecycle: true`, other sessions calling `dequeue` still observe the closed session's `session_closed` signal (internal routing intact); the governor still receives any service messages needed for routing. Verified by a dequeue test where session A is silent-lifecycle and session B observes A's close.
4. `action(type: 'profile/silent-lifecycle')` with no `enabled` returns current value; with `enabled` set, mutates and returns previous value. Round-trip via `profile/save` + `profile/load` preserves the value. Verified by unit tests on the action handler and profile serializer.
5. Approval-prompt dialog for a NEW session still appears under `silent_lifecycle: true` (operator must still approve unauthenticated sessions); only the post-approval announcement is suppressed. Verified by end-to-end test against a fresh session.

## Out of scope

- Suppressing non-lifecycle messages (agent's own posts, reactions, errors).
- Suppressing approval prompts (separate concern — see auto-approve).
- Global/server-side default override (per-profile only for v1).
- Retroactive cleanup of historical lifecycle posts.

## Open questions for operator

1. **Reconnect path:** session/start has two flavors — initial approval and reconnect-with-saved-token. Should `silent_lifecycle` suppress both, or should the reconnect path still post (since it's rarer and confirms recovery)? Current draft: suppress both.
2. **Ungraceful close (crash/timeout) announcements:** if a silent-lifecycle session is reaped by the unresponsive-session detector rather than closed gracefully, should the unresponsive-warning + back-online dance also be suppressed, or do those count as "errors" and stay visible? Current draft: keep visible (operator wants to know if a silent pod actually died).
3. **Default rollout per pod class:** ship as opt-in only (every profile starts `false`, operator toggles per pod), or seed Zhu-Li / future containerized-assistant profiles with `true` at provisioning time? Current draft: opt-in only; provisioning scripts set `true` for known high-churn classes.
4. **Visibility audit:** should there be a way for the operator to list which loaded profiles currently have `silent_lifecycle: true` (e.g. via `session/list` showing a `silent` flag), so a silenced pod is not invisible by accident? Current draft: yes, surface in `session/list`.
