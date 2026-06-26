---
title: "V8 Rich Messages — native rich-default send pipeline (implementation)"
created: 2026-06-26
status: draft
priority: 10
type: Story
source: Operator deliberation — Telegram feature audit (2026-06-26)
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
epic: 10-3001
depends_on:
  - 10-3017   # spikes + re-spec MUST pass first
blocked_by: 10-3017
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
---

# 10-3018 — Native rich-default send pipeline

> **Blocked by [10-3017](10-3017-v8-rich-messages-native-pivot-spikes.md).**
> Do not start until those spikes pass and the epic is re-spec'd. Several phase
> details below are *contingent* on specific spike outcomes — each is marked
> `⟵ gated on Spike X`. If a spike fails, revisit this story before building.

## Story

As an agent, I write standard Markdown (and occasionally HTML) and "just send."
The bridge renders it via Bot API 10.1 rich messages by default — no `parse_mode`,
no MarkdownV2 escaping, tables and headings render — and a send **never fails**:
on any rich error it degrades to plain text. Legacy formatting survives only as
the invisible fallback floor and for media/voice captions.

This story implements the pivot the spikes prove out.

## Phases (each independently mergeable)

### P1 — Native grammY engine swap
- Replace raw-fetch `sendRichMessageDirect` / `updateRichMessageDraftDirect` /
  `finalizeRichMessageDraftDirect` in `src/telegram.ts` with native
  `getApi().sendRichMessage(...)` and `sendRichMessageDraft(...)`.
- Correct the draft lifecycle: `sendRichMessageDraft({ chat_id, draft_id,
  rich_message })` (ephemeral ~30 s) → persist via `sendRichMessage`. Remove the
  bogus `finalize` stub.
- Delete the stale "Bot API 10.1 … not yet in grammY" comments.
- Errors flow through `GrammyError` → `classifyGrammyError` and `callApi`
  rate-limit retry like every other call.

### P2 — Format-by-param contract on `send`
- New text surface: `text` (→ rich Markdown, the default "just send"),
  `html` (→ `rich_message.html`, verbatim), `string` (literal; maps internally to
  `rich_message.html` with `<>&` escaped — `InputRichMessage` has no plaintext
  field). All optional, mutually exclusive among the trio, mixable with `audio`.
- **Deprecate `parse_mode`**: still accepted for one release as a legacy alias
  (`Markdown`→`text`, `HTML`→`html`, `MarkdownV2`→legacy floor), then removed.
- **Degrade-never-fail floor:** rich send → on parse/availability error → retry
  as plain text so the message always delivers. Emit a service-message note when
  the floor is hit.

### P3 — Default-on flip  ⟵ gated on Spikes B + D
- Remove the `RICH_MESSAGES` env gate; rich becomes the default path.
- Keep a kill-switch env var to force legacy (ops safety), default = rich.

### P4 — Retire legacy markdown machinery on the rich path  ⟵ gated on Spike A
- If Spike A confirms server-side GFM parsing: park/remove `markdownToRichBlocks`
  (10-3013/3014) for the default path; the default send is a `{ markdown }` pass.
- Retire `TABLE_WARNING` and the `containsMarkdownTable` check on the rich path —
  GFM tables render natively.
- Chunking: apply the Spike C length finding — reduce or remove `splitMessage`
  for rich if the limit is higher than 4096.

### P5 — Migrate auxiliary send/edit paths
- Move to rich (all confirmed supported via `reply_markup` / `rich_message` edits):
  `notify`, `append`, `progress`, `choice`/`choose`/`confirm`/`ask`,
  `stream/*` (use `sendRichMessageDraft` for live updates), button-collapse edits.
- **Stay legacy (permanent):** `send_file` and `sendVoiceDirect` captions —
  `caption`+`parse_mode`, no `rich_message` field on those methods.
- Session-close cleanup: cancel any open draft (`draft_id`) so it doesn't linger.

## Folds-in / retargets
- [15-0012 copy_text](15-0012-copy-text-buttons-send-option.md) — `reply_markup`
  works on `sendRichMessage`; implement on the rich path.
- [30-0012 message-effects](30-0012-message-effects.md) — `message_effect_id`
  works on `sendRichMessage`; implement on the rich path.
- [15-0011 link-preview](15-0011-link-preview-options.md) — **retarget**:
  `sendRichMessage` has no `link_preview_options`. This story does NOT add link
  control; 15-0011 must be re-scoped to caption/fallback or "rich link rendering."

## Acceptance criteria
- [ ] 10-3017 closed (spikes passed, epic re-spec'd) — verified before merge.
- [ ] P1: no raw-fetch rich senders remain; native grammY only; stale TODOs gone.
- [ ] P2: `text`/`html`/`string` contract live; `parse_mode` deprecated-but-accepted;
      degrade-to-plain floor exercised by a test that forces a rich error.
- [ ] A Markdown message with H2 + GFM table + fenced code + bullet list renders
      as a rich message by default (no env flag).
- [ ] Interactive (`confirm`) and edited (`progress`) messages work on the rich path.
- [ ] Captions still send via the legacy `parse_mode` path.
- [ ] `TABLE_WARNING` no longer fires for rich sends (gated on Spike A outcome).
- [ ] `pnpm build` clean; `pnpm test` passes; no regression in legacy fallback.

## Media constraint (confirmed from Bot API docs)
Rich media blocks (`<img>`/`<video>`/`<audio>`, collage, slideshow) accept
**HTTP/HTTPS URLs only** — no multipart upload, no `data:`/base64, no `file_id`,
no `attach://` (`InputRichMessage` is a pure html/markdown string with no
attachments array). Therefore **local/agent-generated images (screenshots,
charts, rasterized SVG) cannot be embedded in a rich message** — the bridge has
no public host. **Media sends stay on the legacy multipart `sendPhoto`/`send_file`
path; rich covers the text/table/structure body only.** Possible
already-uploaded-image-by-file-API-URL workaround is an open spike (10-3017
Spike G) — unverified + token-exposure concern.

## Out of scope
- Programmatic `RichBlock[]` composition tools (agents write Markdown/HTML).
- Business-account-only features (checklists — 20-0013, blocked).
- SVG/vector rendering — not supported by rich messages (rasterize to PNG).
- Embedding local images in rich messages — URL-only media; stays legacy (above).
