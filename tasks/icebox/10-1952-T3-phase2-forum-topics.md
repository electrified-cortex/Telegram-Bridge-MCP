---
id: 10-1952-T3
title: TMCP Phase 2 — Telegram Forum topic integration for sub-sessions
type: task
delegation: Worker-claimable (Overseer dispatches after OQ1 resolved)
stage: blocked
parent: 10-1952
created: 2026-05-16
blocked_on: OQ1 (Forum supergroup vs 1-on-1 — operator decision)
---

# TMCP Phase 2 — Telegram Forum topic integration for sub-sessions

## Blocked

**Do not start until OQ1 is resolved.** OQ1 (from PRD 10-1952 / spike 10-1951): does the operator want Telegram Forum topics in an existing private supergroup, or in a separate dedicated supergroup? This determines `ALLOWED_CHAT_ID` config and the security model change required. Decider: operator.

## Scope (once unblocked)

Per PRD 10-1952 FR4 and spike 10-1951 gap table:

1. Add `ALLOWED_CHAT_ID` env var (group supergroup ID) — distinct from `ALLOWED_USER_ID`.
2. Add `message_thread_id` extraction in `recordInbound()` / `buildMessageContent()` — store on `TimelineEvent`. (~20 lines)
3. Add `topicId → ownerSid` routing map in session-queue. Use `topicId` as routing signal alongside reply-to ownership. (~small)
4. Add `topicId` field to `Session` record. Add `topic/create` action (`createForumTopic` → returns `topicId`). Add binding: `session/spawn-child` accepts optional `topic_id` param.
5. Inject `message_thread_id` in outbound proxy's `sendMessage` for topic-bound sessions.
6. Add `topic/close` action (calls `closeForumTopic`).

## Acceptance criteria (draft — to be finalized after OQ1)

- **AC4.** A child session bound to topic T receives only messages with `message_thread_id = T` in its dequeue. Outbound messages from that child are sent with `message_thread_id = T`. Verified by E2E test in a Forum supergroup.
- **AC-P2-approval.** `session/spawn-child` with `parent_delegated: true` bypasses operator-tap approval. Verified by integration test.

## Estimated effort

2–4 days (per spike 10-1951). No architectural rework — multi-session queuing and reply-to ownership already in place.

## Overseer review

- **Reviewer:** Overseer
- **Date:** 2026-05-16
- **Verdict:** APPROVED for queuing in 30-blocked — do not move to 40-queued until OQ1 resolved
- **Review type:** light-scan (placeholder task — full adversarial review at unblock time)
- **Checked:** blocked status correct, OQ1 identified as the gate, scope pointers accurate per spike report
- **Not checked:** full AC detail (deferred to unblock review), security model specifics (operator decides)
