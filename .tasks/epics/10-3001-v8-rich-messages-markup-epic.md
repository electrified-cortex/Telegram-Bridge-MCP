---
Created: 2026-06-11
Updated: 2026-06-28
Status: Active
Host: local
Priority: High
Source: Operator (voice, 2026-06-11) + spike findings (10-3017, 2026-06-27)
Target: V8
Supersedes: original 2026-06-11 draft (archived in git history)
---

# V8 Rich Messages — Native grammY Pivot (rewritten post 10-3017 spikes)

> **Spike baseline:** All decisions in this epic are grounded in live spike results from
> task [10-3017](../50-active/10-3017-v8-rich-messages-native-pivot-spikes.md) (2026-06-27).
> Every assumption in the original epic has been tested against the live bot.

## Objective

TMCP sends rich Bot API 10.1 messages by default, using **native grammY** and
**server-side Markdown parsing** — no raw-fetch, no hand-rolled compiler.
Agents write standard Markdown. The upgrade is invisible to callers.

**Success criterion:** lose nothing, gain everything.
- Every message that renders correctly today continues to render correctly.
- Every Bot API 10.1 rich feature reachable through ordinary `send(string: "...")`.
- Rich is the default; legacy is the never-fail floor and the caption permanent path.

## What the spikes confirmed

| Spike | Finding |
|:------|:--------|
| A — Server-side markdown | `sendRichMessage({ rich_message: { markdown } })` renders H2/H3, GFM tables, lists, code blocks, bold, italic, links — **no compiler needed** |
| B — Client rendering | Operator visual confirm: all constructs render correctly on current Telegram client |
| C — Length limit | **32768 chars** (8× the legacy 4096 cap). `splitMessage` threshold moves to 32768. |
| D.1 — Inline keyboard | Works on rich messages ✅ |
| D.2 — Edit in place | `editMessageText({ rich_message })` works ✅ |
| D.3 — Message effects | `message_effect_id` accepted on `sendRichMessage` ✅ |
| D.4 — Reply threading | `reply_parameters` works on rich sends ✅ |
| E — Draft streaming | `sendRichMessageDraft(draft_id, rich_message)` → `sendRichMessage` (persist). No separate finalize endpoint. ~30s draft TTL, self-expires on close. |
| F — Caption path | `sendPhoto`/`sendVoice`/etc. do NOT accept `rich_message` — caption path stays `parse_mode` permanently |
| G — Image embed | HTTPS URLs embed as inline images ✅. Local files: `sendPhoto`→`getFile`→URL workaround (token-exposure tradeoff; acceptable for private 1-on-1 bots) |

## The new contract (three-tier send architecture)

Agent-facing `send` surface — **no `parse_mode`**. The three tiers:

| Tier | Param | Meaning | Internally routes to |
|:-----|:------|:--------|:---------------------|
| 1 | `html` | **Passthrough** — caller provides finished HTML; grammY passes it directly to the rich message renderer (HTML mode), no TMCP processing | grammY rich message renderer (HTML mode) |
| 2 | `markdown` | **Passthrough** — caller provides finished GFM markdown; grammY passes it directly to the rich message renderer (GFM mode; full GFM: tables, headings, lists, code blocks), no TMCP processing | grammY rich message renderer (GFM mode) |
| 3 | `string` | **Smart path** — de facto agent path (99% of sends): `markdownToRichBlocks` auto-detects whether content is GFM markdown; if yes → grammY GFM renderer; if plain text → plain string send. Never auto-detects HTML. | `markdownToRichBlocks` smart detection (preserved unchanged) |
| — | `audio` | TTS voice | unchanged |

- `string`, `html`, `markdown` are mutually exclusive; all mixable with `audio`.
- `string` is the safe default — agents write markdown, smart detection routes correctly.
- `html` and `markdown` are expert passthrough paths for callers who provide finished formatted content.
- `parse_mode` — **deprecated**. Accepted for one version as a legacy alias, then removed.
- Rich is the send default. No `RICH_MESSAGES` opt-in gate.

> **See also:** [Regression Guard](#regression-guard) — `markdownToRichBlocks` on the `string:` path is preserved unchanged.

## Never-fail floor (legacy is the floor, not the path)

Rich → on `RICH_MESSAGE_UNSUPPORTED` / any rich-path error → retry with
`sendMessage` (MarkdownV2 via `resolveParseMode`). The caller never sees the
difference. This covers:
- Old Telegram clients that don't support Bot API 10.1.
- Bot API server configurations without 10.1 availability.
- Any future API regressions.

## Caption permanent exception

`sendPhoto`, `sendVoice`, `sendDocument`, `sendVideo`, and all other media-bearing
methods use `caption` + `parse_mode` — **NOT `rich_message`**. This is a Telegram
Bot API constraint (confirmed type-level + empirically in Spike F). The rich path
does not apply to captions now or in future phases.

## Draft / streaming lifecycle (corrected)

Old epic was wrong. The real lifecycle:

```
sendRichMessageDraft(chat_id, draft_id, rich_message)   // initial ephemeral draft (~30s TTL)
sendRichMessageDraft(chat_id, draft_id, rich_message)   // ...call again to update in-place
...
sendRichMessage(chat_id, rich_message)                  // persists final message; draft disappears
```

- `draft_id` is a client-side integer for animation continuity — tracks which draft to replace.
- No separate "finalize" endpoint. `sendRichMessage` IS the finalize call.
- If the session closes before `sendRichMessage`: draft TTL expires (~30s), disappears automatically. No cleanup needed.
- **Old names (wrong, remove):** `updateRichMessageDraftDirect`, `finalizeRichMessageDraftDirect`.

## Length limit change

| Path | Char limit |
|:-----|:-----------|
| Legacy `sendMessage` | 4096 |
| Rich `sendRichMessage` | **32768** |

`splitMessage` / `LIMITS.MESSAGE_TEXT` must be updated to 32768 for the rich path.
Chunking still needed for >32768 content (e.g., very long logs), but practically
eliminated for normal agent responses.

## Image embedding in rich

- **Public HTTPS URL**: embed directly as `![alt](https://...)` in the markdown field. Renders inline. ✅
- **Local file**: `sendPhoto(local_file)` → `getFile()` → use `https://api.telegram.org/file/bot<TOKEN>/<path>` as the `<img src>`. Token-exposure tradeoff: the bot token is embedded in message history. Acceptable for private 1-on-1 bots (this bot's primary use case); document the tradeoff.
- **Local file (no token exposure)**: fall back to `sendPhoto` multipart on the legacy path.

## What's dropped / retired

| Item | Disposition |
|:-----|:------------|
| `sendRichMessageDirect` (raw-fetch) | **RETIRE** — native grammY replaces it |
| `updateRichMessageDraftDirect` | **RETIRE** — never-real endpoint; use `sendRichMessageDraft` |
| `finalizeRichMessageDraftDirect` | **RETIRE** — `sendRichMessage` is the finalize call |
| `markdownToRichBlocks` compiler (10-3013/10-3014) | **NOT retired** — IS the `string:` path smart-detection implementation. `html`/`markdown` paths are grammY passthroughs that do not go through `markdownToRichBlocks`; on the `string:` path it is the core logic, unchanged. |
| `RICH_MESSAGES` opt-in env var gate | **REMOVE** — rich is the default |
| `parse_mode` param on `send` tools | **DEPRECATE** (one-version alias) → **REMOVE** |

## What's kept unchanged

| Item | Status |
|:-----|:-------|
| `resolveParseMode` pipeline | Kept — drives the never-fail floor |
| Legacy `sendMessage` path | Kept — floor + caption path |
| `sendPhoto`, `sendVoice`, `sendDocument`, etc. | Unchanged |
| `sendVoiceDirect` raw-fetch | Unchanged (grammY still doesn't wrap voice in same way) |
| Chunking logic | Kept — threshold changes to 32768 for rich path |
| Rate-limiter integration | Unchanged |
| Session header injection (`outbound-proxy.ts`) | Unchanged |
| `docs/rich-message-schema.md` snapshot | Still valuable — retain |
| `markdownToRichBlocks` on `string:` path | **Preserved unchanged** — IS the `string:` path; see Regression Guard |

## Regression Guard

**string: path: markdownToRichBlocks smart detection is preserved unchanged. This is not optional. Removing this from the string: path is a regression.**

The `string:` parameter path must produce identical agent-message rendering to current production:
- Smart markdown detection runs on all `string:` content.
- If markdown detected → markdownToRichBlocks conversion → grammY GFM renderer (or equivalent).
- If no markdown → plain text send (legacy path or rich with escaped content).
- No agent using the `string:` path should see any change in rendered output.

## Phased implementation (for task 10-3018)

Each phase is independently mergeable and testable.

### Phase 1 — Engine swap: native grammY senders

Replace `sendRichMessageDirect` (raw-fetch) with native `api.raw.sendRichMessage` /
`api.raw.sendRichMessageDraft` / `api.raw.editMessageText({ rich_message })` calls.

- Remove `sendRichMessageDirect`, `updateRichMessageDraftDirect`, `finalizeRichMessageDraftDirect`.
- Add `sendRichNative(chatId, richMessage, options)` — thin wrapper over grammY.
- Add `sendRichDraftNative(chatId, draftId, richMessage)` — wraps `sendRichMessageDraft`.
- Keep all option pass-through: `reply_markup`, `reply_parameters`, `message_effect_id`, `disable_notification`.
- No routing change yet — test via explicit internal calls.

### Phase 2 — Three-tier format-by-param contract + never-fail floor

- Replace `parse_mode` param on `send` tools with the three-tier surface: `string` / `html` / `markdown`.
- Route (three tiers):
  - `html` → grammY passthrough (HTML mode) — no TMCP processing.
  - `markdown` → grammY passthrough (GFM mode) — no TMCP processing; full GFM (tables, headings, lists, code blocks).
  - `string` → `markdownToRichBlocks` smart detection: if GFM markdown → grammY GFM renderer; if plain text → plain string send. **`markdownToRichBlocks` logic unchanged.**
- Implement never-fail floor: catch rich-path errors → retry → `sendMessage`.
- Deprecate `parse_mode` param (emit warning; still accepted this version).
- Update `LIMITS.MESSAGE_TEXT` to 32768.

### Phase 3 — Default-on flip + docs

- Remove `RICH_MESSAGES` env var gate (was never real yet — but ensure no trace remains).
- `markdownToRichBlocks`: unchanged — it IS the `string:` path. No retirement, no relocation.
- Mark `parse_mode` param as removed (breaking, not just deprecated).
- Update `docs/formatting.md` with the three-tier format-by-param contract.

### Phase 4 — Streaming integration

- Replace draft streaming paths: `sendRichMessageDraft` (initial + updates) → `sendRichMessage` (persist).
- Remove `finalizeRichMessageDraftDirect` references; wire `sendRichNative` as the finalize.
- Wire existing stream/notification flows to the new draft lifecycle.
- Verify draft TTL / session-close behavior (no cleanup needed per Spike E).

### Phase 5 — Auxiliary paths + fold-in related stories

- Fold in **15-0012** (copy_text buttons): confirmed working on `sendRichMessage` → implement.
- Fold in **30-0012** (message effects): confirmed working → implement `message_effect_id` pass-through.
- Retarget **15-0011** (link-preview options): `sendRichMessage` has NO `link_preview_options` — rich handles links internally. Document: link preview control is a legacy-only feature; rich link rendering is Telegram-managed.
- Update `docs/help/` formatting topics (integrates with epic 10-2107).
- Full `splitMessage` audit for rich path.

## Downstream / related tasks

| Task | Status | Notes |
|:-----|:-------|:-------|
| 10-3018 (implementation) | **UNBLOCKED** — this epic is the spec | Depends on 10-3017 (done) |
| 15-0012 (copy_text buttons) | **Fold into 10-3018 Phase 5** | Confirmed working on rich |
| 30-0012 (message effects) | **Fold into 10-3018 Phase 5** | Confirmed working on rich |
| 15-0011 (link-preview options) | **RETARGET** — legacy-only | Rich has no `link_preview_options` |

## Acceptance criteria

- [ ] `api.raw.sendRichMessage(...)` sends a rich message; grammY native replaces raw-fetch everywhere.
- [ ] `send(string: "# Heading\n\n**bold**")` routes via `markdownToRichBlocks` smart detection → renders as a rich message with correct formatting in Telegram.
- [ ] `send(string: "plain text, no markdown")` routes to plain text send (smart detection finds no markdown).
- [ ] `send(html: "<b>bold</b>")` passes through grammY renderer (HTML mode) → sends as rich HTML.
- [ ] `send(markdown: "# GFM heading\n\n| col | col |\n|-----|-----|\n| a | b |")` passes through grammY renderer (GFM mode) → renders table correctly.
- [ ] Never-fail floor works: if rich fails, message delivers via legacy path.
- [ ] Caption path unchanged: `sendPhoto(caption: "...")` uses `parse_mode`, not rich.
- [ ] Draft streaming: `sendRichMessageDraft` → `sendRichMessage` lifecycle works end-to-end.
- [ ] `LIMITS.MESSAGE_TEXT` updated to 32768; `splitMessage` threshold updated.
- [ ] No existing tests broken; new tests cover rich send, floor fallback, format routing.
- [ ] `docs/formatting.md` updated with format-by-param contract.
- [ ] 15-0012 (copy_text) and 30-0012 (effects) implemented as part of Phase 5.
- [ ] `parse_mode` param removed from public `send` API.
