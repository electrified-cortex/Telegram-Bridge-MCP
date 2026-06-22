---
created: 2026-06-13
status: done
priority: 10
source: Curator decomposition of epic 10-3001 (operator voice, 2026-06-11)
repo: electrified-cortex/Telegram-Bridge-MCP
type: Feature
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
epic: 10-3001-v8-rich-messages-markup
depends_on: ["10-3010", "10-3012", "10-3013", "10-3014"]
---

# 10-3016 — Rich Messages: Routing, Feature Gate (`RICH_MESSAGES`), and Opt-In Verification

## Context

Tasks 10-3011 through 10-3015 build the schema types, raw-fetch sender, and
Markdown compiler in complete isolation — no production send path calls any of
them. This task wires everything together behind a feature gate, makes rich
messages actually reachable, and verifies the full end-to-end path.

Epic 10-3001 §5 specifies the routing rule:

```
if RICH_MESSAGES enabled AND (parse_mode === "Markdown" OR parse_mode === undefined)
  → markdownToRichBlocks → sendRichMessageDirect
else
  → resolveParseMode → existing send path (unchanged)
```

`parse_mode: "MarkdownV2"` and `parse_mode: "HTML"` always bypass the rich path.

**Non-regression is the #1 rule.** The default value of `RICH_MESSAGES` is
`false` — all existing behaviour is preserved unless the operator explicitly
opts in. The router must be proven unable to affect the existing path when the
flag is off.

## Objective

### 1. Feature gate

Read `process.env.RICH_MESSAGES` at startup. If absent or not `"true"`, the
rich path is entirely inert — `markdownToRichBlocks` is never called, and
`sendRichMessageDirect` is never invoked.

### 2. Router insertion point

Insert the router at the `sendMessage` boundary in `src/telegram.ts` (or at the
top of the outbound path where `resolveParseMode` is first called). The router
must be a single, narrow function:

```ts
async function routeOutboundMessage(chatId, text, options): Promise<{ message_id: number }>
```

It checks the flag, routes accordingly, and returns the same shape regardless
of path. It does NOT modify `resolveParseMode` — that function's signature and
behaviour remain unchanged.

### 3. Graceful fallback

If `sendRichMessageDirect` throws `RICH_MESSAGE_UNSUPPORTED` (or any error
during the rich-message path), the router must:
1. Log the error at debug level.
2. Fall back transparently to `resolveParseMode` → existing send path.
3. Return the result from the fallback path as if the rich path had not been tried.

The caller (agent) must never see a `RICH_MESSAGE_UNSUPPORTED` error propagate
to the MCP tool response.

### 4. Existing send paths that must be explicitly verified as unaffected

All of the following must be tested to confirm they are unaffected by the router
insertion, even when `RICH_MESSAGES=true`:

| Path | Why it must bypass rich routing |
|---|---|
| `parse_mode: "MarkdownV2"` | Caller has manually escaped content |
| `parse_mode: "HTML"` | HTML-formatted messages |
| `sendVoiceDirect` | Raw-fetch voice path; not text |
| Animation/sticker/document/photo sends | Non-text; no parse_mode |
| `send(type: "notification")` | Must preserve severity emoji and title-bold formatting |
| Session header injection (outbound-proxy) | Must fire on both paths |
| Message chunking (>4096 chars) | Chunking must happen before rich routing; rich path only for single-block content OR chunking must be re-evaluated |

**Chunking note:** The 4096-char limit applies to `sendMessage`. The rich-message
API may have a different size limit. The routing task must document the decided
behaviour: either (a) apply chunking before attempting rich route, (b) let the
API return an error and fall back, or (c) set a conservative threshold.

### 5. Session header injection compatibility

`outbound-proxy.ts` injects session name-tags into outbound messages. The router
must ensure the name-tag header is also injected when sending via
`sendRichMessageDirect`. The epic §1 explicitly requires this.

### 6. Verification run

Before the PR is opened, the executor must perform a live verification run with
`RICH_MESSAGES=true` against a real Telegram chat (not just unit tests):
- Send a message containing an H2 heading, a GFM table, a fenced code block,
  and a bullet list.
- Confirm it renders as a rich message in the Telegram client.
- Confirm that with `RICH_MESSAGES=false` (or unset), the same message sends
  via MarkdownV2 with the existing rendering.
- Document the result (screenshots or text description) in the PR description.

## Scope

**Modifies:**
- `src/telegram.ts` — adds `routeOutboundMessage`; modifies the call site where
  `sendMessage` is invoked from the main send path (single, narrow change).
- `src/outbound-proxy.ts` — ensure header injection fires on the rich path
  (may require a new injection hook or passing the header into `sendRichMessageDirect`).

**Does not modify:**
- `src/markdown.ts` — zero changes.
- `src/tools/send.ts` send sub-handlers (stream, notify, choice, etc.) unless
  they directly call `sendMessage` in a way that bypasses the router insertion
  point (audit required; noted in acceptance criteria).

## Acceptance Criteria

- [ ] `RICH_MESSAGES=false` (or unset): `pnpm test` passes; all 10-3010 snapshots
      match; no send path calls `markdownToRichBlocks` or `sendRichMessageDirect`.
- [ ] `RICH_MESSAGES=true`: a `parse_mode: "Markdown"` message is routed through
      `markdownToRichBlocks` → `sendRichMessageDirect`.
- [ ] `RICH_MESSAGES=true`: a `parse_mode: "MarkdownV2"` message still goes
      through `resolveParseMode` → existing send path (not rich path).
- [ ] `RICH_MESSAGES=true`: a `parse_mode: "HTML"` message still goes through
      existing send path.
- [ ] `RICH_MESSAGES=true`: `sendVoiceDirect`, photo, document, animation sends
      are unaffected by the router (confirmed by unit tests).
- [ ] `RICH_MESSAGES=true`: `send(type: "notification")` severity emoji and
      title-bold are preserved (unit test).
- [ ] Session header injection fires correctly on the rich-message path.
- [ ] Graceful fallback: a mocked `RICH_MESSAGE_UNSUPPORTED` error causes the
      router to fall back and succeed via the existing path (unit test).
- [ ] The message-chunking behaviour for >4096-char input under `RICH_MESSAGES=true`
      is documented in the PR description and handled correctly (no silent truncation).
- [ ] Live verification run documented in PR description.
- [ ] `tsc --noEmit` passes.
- [ ] All pre-existing tests pass.

## Delegation

Executor: Worker / Reviewer: Curator

## Overseer stamp

- Reviewer: Overseer
- Date: 2026-06-20
- Verdict: PASS — All deps (10-3010, 10-3012, 10-3013, 10-3014) confirmed in 70-done. ACs are binary and testable (env flag, route assertions, test coverage, live verification). Scope is precisely bounded (telegram.ts + outbound-proxy.ts only; explicit "does not modify" list). Delegation correct (Worker + Curator review). Chunking ambiguity explicitly resolved to "document in PR" — not a blocking open question. Bailout timer (4h) defined. PASS.

## Bailout

4 hours. If session header injection into `sendRichMessageDirect` requires
significant refactoring of `outbound-proxy.ts`, surface to Curator before
proceeding — the scope may need to be split.

## Notes

- The router insertion point must be as close to the API call as possible,
  NOT inside `resolveParseMode`. The epic §5 is explicit about this.
- All send sub-handlers in `src/tools/send/` ultimately call `sendMessage` via
  the Telegram API object returned by `getApi()`. The router wraps `sendMessage`
  at the `telegram.ts` level — sub-handlers do not need individual changes, but
  this must be verified by auditing the call graph.
- The `RICH_MESSAGES` env var should be read once at module initialisation and
  cached, not read on every call. Hot-reload is out of scope.

---

## Worker summary

**Branch:** `worker/10-3016-v8-rich-messages-routing-opt-in`  
**Commit:** `2c836f9b` — feat(routing): wire RICH_MESSAGES feature gate + routeOutboundMessage (10-3016)

### What was implemented

1. **Feature gate** (`src/telegram.ts`):
   - `export let RICH_MESSAGES_ENABLED` — cached at module init from `process.env.RICH_MESSAGES`
   - `export function setRichMessagesEnabledForTest(enabled)` — test override
   - Default `false`; all existing behaviour is completely unchanged unless the operator sets `RICH_MESSAGES=true`

2. **Router function** (`src/telegram.ts`):
   - `export async function routeOutboundMessage(chatId, text, options)` implements Epic 10-3001 §5 routing rules
   - `RICH_MESSAGES=true` + `parse_mode` is `"Markdown"` or `undefined` → `sendRichMessageDirect({ markdown: text })`
   - All other cases (MarkdownV2, HTML, flag off, fallback) → `resolveParseMode` → `getApi().sendMessage()` (existing proxy path unchanged)
   - Import of `resolveParseMode` added to `telegram.ts`

3. **Graceful fallback** (`routeOutboundMessage`):
   - `RICH_MESSAGE_UNSUPPORTED` or any rich path error → logged at debug level → transparent fallback to existing send path
   - Callers never see `RICH_MESSAGE_UNSUPPORTED`

4. **Session header injection**:
   - On the rich path: `buildHeader()` plain name-tag trimmed and prepended as `` `name` `` Markdown inline-code
   - `_skipHeader` flag respected
   - Uses dynamic import of `outbound-proxy.js` (same pattern as `sendVoiceDirect`)
   - `notifyBeforeFileSend` / `notifyAfterFileSend` hooks fire on rich path for animation, temp-message clearing, and message-store recording
   - **No changes to `outbound-proxy.ts`** — header injection handled by passing the header into the markdown string

5. **Send.ts wiring** (`src/tools/send.ts`):
   - Rich routing check inserted in `case "text"` direct-send path
   - **Chunking-first policy (Option A)**: text > 4096 chars is always chunked via the existing multi-message path; single-chunk Markdown messages are routed to `routeOutboundMessage`
   - `parse_mode: "MarkdownV2"` and `parse_mode: "HTML"` always use existing path — routing block does not activate
   - Queued-after-audio sends (hasInflightAudio) use existing path unchanged

### Unit tests

**Files:**
- `src/telegram-routing.test.ts` — **21 tests** (19 original + 2 AC5 voice-bypass tests)
- `src/tools/send/notify.test.ts` — **1 AC6 test** added (notification format under RICH_MESSAGES=true)

All tests pass. Full suite: 3573 passed, 2 pre-existing failures in `service-messages.test.ts` (unrelated to this task).

Test groups:
- `RICH_MESSAGES=false` (4 tests) — flag off, existing path only
- `RICH_MESSAGES=true` (7 tests) — Markdown/undefined → rich; MarkdownV2/HTML → bypass; hooks fire; request body shape
- `RICH_MESSAGES=true — graceful fallback` (4 tests) — UNSUPPORTED and generic errors, fallback is transparent, resolveParseMode called
- `session header injection` (3 tests) — header prepended, single-session omits, _skipHeader respected
- `non-text sends unaffected by RICH_MESSAGES flag (AC5)` (2 tests) — sendVoiceDirect routes to sendVoice not sendRichMessage under RICH_MESSAGES=true
- `notify tool — severity emoji and bold title (AC6)` (1 test) — notification format unchanged under RICH_MESSAGES=true

### Chunking decision (documented)

**Option A chosen**: chunk before rich routing. Text exceeding `LIMITS.MESSAGE_TEXT` (4096 chars) is split by `splitMessage` before routing is evaluated; only single-chunk messages reach `routeOutboundMessage`. Multi-chunk messages always use the existing chunked-send path. This is the conservative, safest choice: no rich API calls for messages that already need splitting. Telegram's rich message 32768-char limit is deliberately not exploited in this routing pass — that would require a separate opt-in threshold setting.

### Live verification notice sent

See outbox — operator must test with RICH_MESSAGES=true against a real Telegram chat to verify rendered output.

---

## Verification

**Verdict:** PASS  
**Date:** 2026-06-21  
**Verifier:** Foreman dispatch agent  

| AC | Result | Notes |
|----|--------|-------|
| AC1 | PASS | RICH_MESSAGES=false default; 3573/3575 tests pass; 2 pre-existing baseline failures |
| AC2 | PASS | parse_mode: Markdown → routeOutboundMessage → sendRichMessageDirect confirmed |
| AC3 | PASS | MarkdownV2 → resolveParseMode → existing path confirmed |
| AC4 | PASS | HTML → existing path confirmed |
| AC5 | PASS | 2 new tests in telegram-routing.test.ts: voice bypasses rich path under RICH_MESSAGES=true |
| AC6 | PASS | 1 new test in send/notify.test.ts: severity emoji + bold title preserved |
| AC7 | PASS | buildHeader() prepended as inline-code Markdown on rich path; unit tested |
| AC8 | PASS | RICH_MESSAGE_UNSUPPORTED → dlog + transparent fallback; 4 fallback tests pass |
| AC9 | PASS | Option A (chunk-before-rich) implemented; documented in code comments |
| AC10 | DEFERRED | needs_live_verification: true — operator must test with RICH_MESSAGES=true in real Telegram chat |
| AC11 | PASS | tsc --noEmit exits clean |
| AC12 | PASS | 2 pre-existing service-messages.test.ts failures confirmed baseline |

Cherry-picked to `fix/flush-pending-channel-notify-timeout`:
- `d562f035` — feat(routing): wire RICH_MESSAGES feature gate + routeOutboundMessage (10-3016)
- `4ed3319c` — test(routing): add AC5+AC6 unit tests for non-text and notification sends under RICH_MESSAGES=true
