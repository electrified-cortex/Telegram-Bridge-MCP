---
title: "V8 Rich Messages — native-grammY pivot + spike re-baseline"
created: 2026-06-26
status: queued
priority: 10
type: Spike + Spec
source: Operator deliberation — Telegram feature audit (2026-06-26)
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: dev
epic: 10-3001
supersedes_assumptions_in: .tasks/epics/10-3001-v8-rich-messages-markup-epic.md
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
note: "Requires LIVE bot access — Spikes A–D send real messages and need a human to eyeball client rendering (Spike B). Not a sandbox/headless task."
related:
  - .tasks/10-drafts/15-0011-link-preview-options.md
  - .tasks/10-drafts/15-0012-copy-text-buttons-send-option.md
  - .tasks/10-drafts/30-0012-message-effects.md
---

# 10-3017 — Rich Messages native pivot: spikes first, then re-spec

## Why this exists

The v8 rich-messages epic ([10-3001](../epics/10-3001-v8-rich-messages-markup-epic.md))
and its completed phases (10-3010…10-3016) were built on two assumptions that are
**now false**, discovered during the 2026-06-26 feature audit:

1. **"grammY has no rich-message support; must raw-fetch."**
   ❌ Installed `grammy@1.44.0` + `@grammyjs/types@3.28.0` expose
   `sendRichMessage`, `sendRichMessageDraft`, `replyWithRichMessage`,
   `InputRichMessage`, and the full `RichBlock*`/`RichText*` surface natively
   (dedicated `rich.d.ts`). The raw-fetch `sendRichMessageDirect` in
   `src/telegram.ts` and its "not yet in grammY" TODOs are stale.

2. **"We must compile Markdown into a `RichBlock[]` array ourselves
   (`markdownToRichBlocks`)."**
   ❓ `InputRichMessage` has a `markdown` field documented as *"Content of the
   rich message to send described using Markdown formatting"* — strongly
   implying **Telegram parses GFM server-side**. If confirmed (Spike A), the
   hand-rolled compiler (phases 10-3013/3014) is unnecessary for the default
   path — you send `{ markdown: text }` and Telegram does the blocks.

Type-level facts already verified locally (`@grammyjs/types@3.28.0`):

- `sendRichMessage` accepts `reply_markup` (inline keyboards), `reply_parameters`,
  `message_effect_id`, `message_thread_id`, `disable_notification`.
- `editMessageText` accepts a `rich_message?` field; `editMessageReplyMarkup` /
  `editMessageCaption` / `editMessageMedia` exist → rich messages are editable.
- `sendRichMessage` has **no `link_preview_options`** (rich handles links itself).
- `InputRichMessage` fields: `markdown?`, `html?`, `is_rtl?`,
  `skip_entity_detection?` — **no plaintext field**.
- `sendRichMessageDraft({ chat_id, draft_id, rich_message })` is the real
  streaming primitive (ephemeral ~30 s preview); persist by calling
  `sendRichMessage`. There is **no** separate `finalize` call — the epic's
  `updateRichMessageDraftDirect` → `finalizeRichMessageDraftDirect` lifecycle is
  wrong.

This task runs the spikes to confirm the runtime behavior, then re-specs the
epic around the simpler native model.

## Target contract (the pivot)

Agent-facing `send` surface becomes **format-by-param-name**, no `parse_mode`:

- `text` — the default "just send"; rendered as **rich Markdown**. Agents speak
  Markdown, so this is the 99% path.
- `html` — passed straight to `rich_message.html`, no alteration.
- `string` — literal/plain escape hatch for code/logs (maps internally to
  `rich_message.html` with `<>&` escaped — the only clean truly-literal path,
  since `InputRichMessage` has no plaintext field).
- `audio` — unchanged (TTS voice).
- All optional, mutually exclusive among the text trio, mixable with `audio`.
- `parse_mode` — **deprecated**, still accepted for one version as a legacy
  alias, then removed.

**Legacy is demoted, not deleted.** Keep the old `parse_mode` send path alive as:
(a) the invisible **never-fail floor** — rich → on parse/availability error →
plain text, so a send *always* delivers; and (b) the **caption path** —
`sendPhoto`/`sendVoice`/etc. captions are `caption`+`parse_mode`, not
`rich_message`, so media/voice captions stay legacy permanently.

## Spikes (do these FIRST — each has a hard exit criterion)

### Spike A — Server-side Markdown parsing  ⟵ highest leverage
Send `getApi().sendRichMessage({ chat_id, rich_message: { markdown } })` with a
doc containing: an H2, a GFM pipe table, a bullet list, a fenced code block, and
inline bold/italic/link — **with no `markdownToRichBlocks` compiler**.
- **Exit:** renders correctly in Telegram from the raw `markdown` string.
- **If pass:** the compiler is unnecessary for the default path → retire/park
  10-3013/10-3014 compiler code; default path is a one-line `{ markdown }` pass.
- **If fail:** document exactly which constructs need client-side compilation;
  the compiler survives only for those.

### Spike B — Client rendering / availability
Confirm the operator's actual Telegram client(s) (mobile + desktop + web if used)
render rich messages cleanly, and observe what a deliberately old/unsupported
client shows.
- **Exit:** screenshot confirmation on the operator's primary device; note any
  context where `RICH_MESSAGE_UNSUPPORTED` fires. Determines how often the
  fallback floor is actually exercised.

### Spike C — Length limits
Find the rich-message max length empirically (legacy text field caps at 4096).
- **Exit:** a known cap (or "no practical cap"). Determines whether `splitMessage`
  chunking changes for the rich path — possibly chunk far less, or not at all.

### Spike D — Feature-parity at runtime
Types say these work; confirm they behave:
- inline keyboard on a rich message → operator tap → callback round-trips;
- `editMessageText({ rich_message })` edits a rich message in place;
- `message_effect_id` plays on a rich send;
- `reply_parameters` threads a reply.
- **Exit:** all four demonstrated. Gates whether `choice`/`confirm`/`ask`,
  `progress`, `animation`, `stream`, `append` can move to rich.

### Spike E — Draft streaming (lower priority, can defer)
Exercise `sendRichMessageDraft({ draft_id })` live-update → `sendRichMessage`
persist for the `stream/*` send types.
- **Exit:** a streamed draft updates live then persists; draft-id lifecycle +
  session-close cleanup understood.

### Spike F — Caption & fallback floor
Confirm media/voice captions cannot take `rich_message` (stay `parse_mode`), and
specify the degrade-to-plain floor behavior.
- **Exit:** documented; floor path written down.

### Spike G — Media-by-URL in rich (image embedding)  ⟵ resolves a known constraint
Confirmed from docs: rich media blocks (`<img>`/`<video>`/`<audio>`) accept
**HTTP/HTTPS URLs only** — no multipart, no `data:`/base64, no `file_id`. So local
images can't be embedded directly. Test the one possible workaround: `sendPhoto` a
local file, then reference the resulting `https://api.telegram.org/file/bot<token>/<path>`
(from `getFile`) as an `<img src>` in a rich message.
- **Exit:** does Telegram's rich renderer accept its own file-API URL? If yes,
  note the token-exposure tradeoff and whether it's acceptable. If no, confirm
  **all local image sends stay on the legacy `sendPhoto` multipart path** (rich =
  text/structure only) and record that as the final word for the 10-3018 story.

## Definition of done (this task = spikes + decisions + re-spec only)

This is an **investigation + spec** task. It produces findings, decisions, and a
rewritten epic. It does **not** ship the migration — that lands as the gated
follow-on tasks below.

The sole code-bearing deliverable here is the rewritten epic 10-3001, covering:
native grammY (drop raw-fetch), `{ markdown }` server-side parsing (compiler only
if Spike A says so), rich-as-default (drop the `RICH_MESSAGES` opt-in gate), the
format-by-param contract, demote-legacy floor + caption exception, and the
corrected draft lifecycle.

### Steps
1. Branch from `dev`: `spike/rich-native-pivot`.
2. Write a throwaway script (scratch dir, not committed) that sends against the
   live bot to run Spikes A–D; record outputs + screenshots in this task file.
3. Run Spike A (server-side markdown), B (client render), C (length), D (parity).
   Defer E/F only if time-boxed; otherwise run them too.
4. Record each spike's result + the decisions they force (compiler retire y/n;
   chunking impact; default-on go/no-go).
5. Rewrite epic 10-3001 to the native model; unblock or revise the 10-3018
   implementation story per the findings.
6. `pnpm build` clean; `pnpm test` passes (no product code changed yet).

### Acceptance criteria
- [ ] Spikes A–D executed; results + screenshots recorded **in this file**.
- [ ] Decision recorded: `markdownToRichBlocks` retired or retained (which constructs).
- [ ] Rich length limit known; chunking impact decided.
- [ ] Epic 10-3001 rewritten (or a v2 epic filed) to the native model.
- [ ] Implementation story [10-3018](../10-drafts/10-3018-v8-rich-messages-native-implementation.md) unblocked or revised per findings.
- [ ] `pnpm build` clean; `pnpm test` passes.

## Downstream (gated on this task's findings)

The actual code migration lives in the implementation story
**[10-3018](../10-drafts/10-3018-v8-rich-messages-native-implementation.md)**
(`depends_on: 10-3017`), phased as: engine swap → format-by-param contract +
never-fail floor → default-on flip → retire legacy markdown machinery → migrate
auxiliary paths. It folds in
[15-0012 copy_text](../10-drafts/15-0012-copy-text-buttons-send-option.md) and
[30-0012 message-effects](../10-drafts/30-0012-message-effects.md) (both confirmed
on `sendRichMessage`) and retargets
[15-0011 link-preview](../10-drafts/15-0011-link-preview-options.md) (rich has no
`link_preview_options`). Nothing in 10-3018 starts until these spikes pass — this
task's job is to make those findings concrete so 10-3018 is unblocked or revised.

## Out of scope

- All product-code migration — that's the [10-3018](../10-drafts/10-3018-v8-rich-messages-native-implementation.md) story.
- The default-on flip — a later phase, gated on Spikes B + D passing.
- Business-account-only features (checklists — see 20-0013, blocked).

## Notes

- The completed phases 10-3010…10-3016 are NOT reverted by this task; they're
  re-evaluated. Some (regression baseline, schema snapshot) stay valuable; the
  raw-fetch sender and possibly the compiler are superseded.
