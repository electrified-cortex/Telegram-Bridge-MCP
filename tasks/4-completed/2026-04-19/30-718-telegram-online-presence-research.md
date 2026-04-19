# 30-718 - Research Telegram "online green dot" presence for bot/sessions

## Context

Operator (2026-04-19, voice 38207): can we offer a Telegram-style "online green dot" presence indicator for our bot or per-session? Operator wants the affordance for the same reason it works in regular DMs — at-a-glance signal of "is there an agent paying attention right now."

Currently the bridge surfaces presence only via reactions, typing indicators, and dequeue activity. None of those replicate the Telegram client's native presence dot. If the Bot API supports it (or a workaround exists via the user-bot pattern), it's a low-cost UX win.

## Research Goals

1. **Bot API capability:** Does Telegram's Bot API expose a way for a bot to signal "online" status that renders as the green dot in clients?
2. **User-bot alternative:** If Bot API does not, does the user-account API (MTProto via Telethon/Pyrogram-equivalent — but NOT Python in our stack) expose `updateStatus`/`account.updateStatus` for the bot account?
3. **Per-session vs. global:** Telegram presence is account-scoped, not session-scoped. If we can signal presence at all, it would be one signal for the whole bot, not one per Curator/Worker/Overseer session. Document the implication.
4. **Update frequency / rate limits:** If we can signal online, what's the heartbeat cadence required to keep the dot lit? What's the rate limit?
5. **Existing prior art:** Have any well-known Telegram bots solved this? `@BotFather` doesn't go green; some user-bots (Telethon-based) do. Check.

## Acceptance Criteria

1. Research findings written to a doc (probably `Telegram MCP/docs/research/online-presence.md`).
2. Verdict: feasible / partially feasible / not feasible via Bot API alone.
3. If feasible: cost estimate (heartbeat tool call frequency, MCP integration sketch).
4. If only feasible via MTProto: tradeoff analysis (added stack complexity vs. UX value). No commitment to implement.
5. If not feasible: brief note and close.

## Constraints

- **No Python in the stack** (per project rule). If the only path is a Python MTProto library, that's a non-starter — note the constraint and stop there.
- Research only. No implementation in this task.
- Don't dispatch the research to a worker that will burn 10k tokens reading every Telegram doc — scope to Bot API method list + a quick MTProto capability check.

## Open Questions

- If we go the user-account / MTProto route, does our bot become a "user" account in some practical/legal sense? (probably yes — verify before recommending.)
- If multiple Curator/Worker sessions are active, does one heartbeat from any of them satisfy the presence requirement? (yes — presence is per-account.)

## Delegation

Worker (TMCP) once research scoped. Curator can scope the question; a single research-tier dispatch (Sonnet, web-search, ~15 min) should produce the verdict without inflating to a full project.

## Priority

30 - low/research. Pure UX nice-to-have. No functional bug, no operator pain. Defer behind anything urgent.

## Related

- TMCP help topic `audio` / `compression` / `send` (other modality discoverability discussions).
- Telegram Bot API docs (canonical: <https://core.telegram.org/bots/api>).

## Completion

**Date:** 2026-04-19
**Worker:** Worker 5 (SID 12)
**Branch:** `30-718`
**Doc:** `docs/research/online-presence.md`

**Verdict:** Not feasible via Bot API (no presence methods). Partially feasible via MTProto `account.updateStatus` using GramJS (Node.js/TS) — but requires a separate user account, carries ToS risk, and adds always-on sidecar complexity. Recommends deferring; UX value does not justify stack complexity.

**Acceptance criteria met:**
1. Research doc written to `docs/research/online-presence.md`
2. Verdict delivered: not feasible via Bot API; partially feasible via MTProto
3. MTProto path: tradeoff analysis included (GramJS available, user-account required, ToS risk)
4. No implementation committed
