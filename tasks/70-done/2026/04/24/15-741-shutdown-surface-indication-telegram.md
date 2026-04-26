# 15-741 - Shutdown surface: announce to Telegram, not just sessions

## Context

Observed 2026-04-19 end-of-session: operator issued `/shutdown` on the bridge. The shutdown *worked* — sessions received a `⛔ Server shutting down. Your session will be invalidated on restart.` service_message via dequeue, MCP transport went down. But on the Telegram chat side, there was **zero indication** that anything was happening. Operator: "ZERO indication in telegram about what was going on. That needs fixing."

The shutdown service message is currently a session-scoped event (delivered through dequeue to live sessions). The human operator watching the Telegram channel sees nothing — no "bridge shutting down," no "fleet dying," no confirmation the shutdown took effect. This is a visibility failure: the operator who initiated the shutdown has no way to watch it complete from Telegram.

## Acceptance Criteria

1. When `/shutdown` fires (or any bridge-initiated shutdown path), post a visible announcement to the Telegram chat before the transport tears down:
   - Who initiated (operator via `/shutdown`, admin, crash recovery, etc.).
   - What's happening ("closing N active sessions", "invalidating tokens", "bridge going offline").
   - Expected next state ("bridge will restart manually" or "bridge is offline until you `pnpm start`").
2. As each session is closed during shutdown, emit a chat-visible line (brief — one per session) so the operator can watch the fleet die in real time. Suppress if more than, say, 10 sessions (use a single summary line instead to avoid flooding).
3. Emit a final "bridge offline" line after all sessions are invalidated and before the process exits. This is the gravestone.
4. Existing session-scoped shutdown `service_message` must still fire (don't remove — sessions still need it via dequeue).
5. Regression test: trigger shutdown in a test bridge with 2 fake sessions; assert that 4 chat-visible messages are posted in order (announcement, session-1 closed, session-2 closed, offline).

## Constraints

- Do not block shutdown on the chat post. If the Telegram API is slow or failing, the shutdown must still proceed — log the failure and continue.
- Do not flood the chat. For large fleets, use a summary ("Closing 15 sessions...") + a completion line rather than one message per session.
- Must use the existing service-message composer path — do not invent a new send surface. The content is new; the rendering path is not.
- Do not leak token values or session SIDs beyond what's already in normal session-close service messages.
- Keep the Telegram chat announcement under the 4096-char limit even for maxed-out fleets.

## Priority

15 - observability / operator UX. Not a data-loss bug, but a trust bug: operator cannot see the lights go out. Makes shutdown feel like a silent crash.

## Delegation

Worker (TMCP) after spec review.

## Related

- 20-731 (vertical service-message layout — same rendering surface).
- 10-732 (false back-online after session/close — adjacent presence-tracker work; kill + shutdown should not trigger "back online").
- Existing `deliverServiceMessage` composer path.
- Shutdown handler wherever `⛔ Server shutting down...` currently emits.
