---
created: 2026-06-13
status: draft
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
