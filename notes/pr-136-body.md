## Summary

Major release. Consolidates reaction intelligence, guided behavior protocol, transport hardening, session-lifecycle governance, and behavioral nudges on top of the v6 4-tool API surface. `master` still holds v6.0.2 — everything between that and current `dev` ships as v7.0.0.

## Breaking Changes

- **Tutorial/instruction response fields removed.** All `tutorial` and `instruction` fields stripped from tool responses. `hint` remains, but only as a pointer to `help()`. Callers parsing those fields must switch to `help()` or the new onboarding service-message stream.
- **Ticket-based session approval.** Session approval now uses one-time cryptographic tickets instead of target names. Governor flow changes: approve via `action(type: "approve", token, ticket)` not by name.
- **Service-message content rewritten.** All `SERVICE_MESSAGES` constant values compressed to minimum-word spec with `help()` breadcrumbs. Consumers matching old message text (tests, client-side routing) will break. 6 governor-change variants consolidated to single `GOVERNOR_CHANGED`. New `SESSION_JOINED` + `ONBOARDING_ROLE_PARTICIPANT` entries.
- **Reaction temporality defaults per emoji.** 5 emojis (🤔 👀 ⏳ ✍ 👨‍💻) are temporary by default; everything else permanent. Explicit `temporary: true/false` always overrides. Callers depending on universal permanence must pass `temporary: false`.

## Reaction System

- **Processing preset**: `react(preset: "processing")` fires 👀 (10s timeout) + 🤔 (clears on next outbound message).
- **Implicit base reaction**: server auto-inserts permanent 👌 at priority -100 on first reaction per message — no message is ever left reaction-less.
- **Auto-clear on outbound**: all temporary reactions from a session clear when that session sends any message.
- **Reaction priority queue**: only the highest-priority reaction is visible; lower ones surface when the top clears.
- **Base-reaction bug fix (#142)**: with a temporary overlay active, the permanent base no longer fires its own redundant API call; `_fireRestoreForSlot` / `clearAllTempReactions` now apply the base only when the last temporary reaction expires.

## Guided Behavior Protocol (replaces tutorials)

- **Service-message onboarding**: 3 messages auto-queued on fresh `session/start` (token save, governor role, protocol guidance). Not on reconnect.
- **`onboarding_buttons` service message**: delivered during session start covering OK / OK-Cancel / Y-N presets and hybrid message guidance (audio + caption + buttons in one message).
- **Behavioral nudge system**: per-session checklist tracks button awareness (`knowsButtons`) and question-without-button count; fires `behavior_nudge_question_hint` on first actionable `?` question sent without buttons, and `behavior_nudge_question_escalation` after 10+ such questions. Nudges suppress once the agent uses buttons in any form or consults button help.
- **`MAX_NUDGES_PER_SESSION`** raised 3 → 5 to accommodate the two new question nudge types.

## Session & Governance

- **`session/rename`**: new optional `color` param (atomic color change with the rename) and optional `target_sid` param (governor only — rename another session; `PERMISSION_DENIED` for non-governor; target-session validation).
- **`session/close/signal`** (governor only): accepts `target_sid` and optional `timeout_seconds`; delivers a `session_close_signal` service message to the target, waits up to the timeout for self-close, force-closes via `closeSessionById` on expiry. Re-checks governor status before force-closing; detects self-close mid-wait; rejects non-governor callers, self-target, and unknown SIDs.
- **`session/close`**: new `force?: boolean` param allows closing the last active session without triggering the last-session guard. Non-forced last-session close rejects with `LAST_SESSION` error + actionable hint.
- **Governor preservation**: governor SID preserved on session teardown; automatic promotion when governor leaves; 2-session bug fixed (10-493) where governor closing a non-governor session accidentally cleared the governor SID.
- **Planned bounce (`session/bounce`)**: governor-initiated restart with snapshot restore.
- **Ticket-based approval**: one-time cryptographic tickets replace target-name approval.

## Shutdown & Lifecycle

- **Zero-sessions bypass**: `shutdown` MCP tool now bypasses the pending-message guard and exits immediately when no sessions are active. The guard still applies when sessions exist.
- **Hard-exit watchdog**: graceful shutdown has a duplicate-request guard and a watchdog so `/shutdown` cannot hang indefinitely on stalled network cleanup.
- **Log roll on shutdown**: local log buffers flushed before exit; when session-log mode is disabled, the active local log is rolled on shutdown.
- **`/shutdown` built-in command**: schedules shutdown on next tick so poller-driven command handling cannot self-block the graceful shutdown wait path.
- **Built-in command stale filtering**: 30-second clock-skew grace window so fresh slash commands are not incorrectly ignored as stale.

## Transport Reliability

- **SSE keepalive**: 30s periodic pings on GET `/mcp` prevent idle transport death.
- **POST keepalive**: keepalive pings during long-running POST requests (voice transcription) prevent silent dequeue drops.
- **Dequeue lost-wakeup fix**: event enqueued between the empty-check and waiter registration could previously leave the agent blocked; now race-free.
- **Log trace action**: `action(type: "log/trace")` for diagnosing dequeue timing and transport issues.
- **Background poller**: starts unconditionally at server startup so built-in commands (`/shutdown`, `/session`, etc.) work even when no session is active.

## Content & Quality

- **Unrenderable character warning**: `send` now scans `finalText` (including topic-prefixed content) and warns when content contains Unicode that doesn't render in Telegram — lists offending chars and code points. Coverage extended to caption and caption-overflow paths, not just the text path.
- **Recording indicator**: no longer drops prematurely between TTS synthesis/upload and message render. `gen` updated after each `showTyping()`; `send_file` voice path cancels typing non-blockingly instead of 3s blocking sleep.
- **`AUTH_FAILED` guidance**: explicitly mentions closed/restarted sessions so mid-session token failures direct agents to `action(type: 'session/reconnect', ...)`.
- **VS16 fix in reaction presets**: `TEMPORARY_BY_DEFAULT` uses `U+270D` without VS16 to match `ALLOWED_EMOJI` in `set_reaction.ts`.

## Documentation

- **`docs/help/` tree**: 130+ help topics with per-route documentation for every action path.
- **Reactions help topic**: new `docs/help/reactions.md` — reaction protocol for agent sessions.
- **`docs/help/dequeue.md`**: `timeout: 0` → `max_wait: 0` in Rule 5 to match current param vocabulary.
- **Button presets table**: `docs/help/guide.md` covers OK, OK-Cancel, Y-N, and custom `choose` patterns.
- **Hybrid section**: `docs/help/send.md` documents audio + caption + buttons composition.
- **Quick-presets callout**: `docs/communication.md` adds button-preset reference under Hard Rule 2.
- **Compression tiers**: full / lite / ultra documented for agent communication.

## Infrastructure

- **Claim permissions reliability**: cross-repo claim paths with SHA-256 hash verification.
- **CI hardening**: pinned pnpm/action-setup versions; Dockerfile updated for `docs/help/`.
- **Version**: 6.0.2 → 7.0.0.

## Test Plan

- [ ] Build clean (`pnpm build`), lint clean (`pnpm lint`), test suite passes (`pnpm test`)
- [ ] Fresh `session/start` delivers full onboarding service-message sequence (token save, governor/worker role, protocol, buttons)
- [ ] `react(preset: "processing")` fires both layers (👀 + 🤔) and clears correctly
- [ ] Temporary reactions clear on next outbound send
- [ ] SSE keepalive holds transport through idle periods
- [ ] POST keepalive prevents silent drops during long transcriptions
- [ ] `session/close/signal` self-close path + timeout force-close both verified
- [ ] `session/rename` with `color` applies atomically; governor `target_sid` path enforced
- [ ] Ticket-based approval flow end-to-end
- [ ] Behavioral nudges fire on actionable questions without buttons; suppress after button use
- [ ] `send` warns on unrenderable chars in text, caption, and overflow paths
- [ ] Copilot review issues addressed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
