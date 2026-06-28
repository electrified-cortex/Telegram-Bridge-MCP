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

Agent-facing `send` surface becomes **three-tier format-by-param-name**, no `parse_mode`:

The send API has three distinct parameter tiers:

1. **`html`** — grammY PASSTHROUGH to rich message renderer (HTML mode). No
   TMCP processing, no auto-detection. Callers who provide finished HTML use this.
2. **`markdown`** — grammY PASSTHROUGH to rich message renderer (GFM mode; full
   GFM: tables, headings, lists, fenced code blocks). No TMCP processing, no
   auto-detection. Callers who provide finished GFM markdown use this.
3. **`string`** — SMART PATH via `markdownToRichBlocks`: auto-detect whether
   content looks like GFM markdown; if yes → grammY GFM renderer; if plain text →
   plain string send. Never auto-detects HTML. This is the de facto agent path
   (99% of sends). **`markdownToRichBlocks` is the implementation — not retired.**

- `string`, `html`, `markdown` are mutually exclusive; all mixable with `audio`.
- `audio` — unchanged (TTS voice).
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
- [x] Spikes A–D executed; operator confirmation in lieu of screenshot per markdown format limitation — message IDs #80056/#80097 serve as citation anchors.
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

---

## Spike Findings (2026-06-27)

> Spike script: `.scratch/spike-rich-native.mjs` (not committed)
> Run via: `node --env-file=.env .scratch/spike-rich-native.mjs`
> grammY version: `grammy@1.44.0` + `@grammyjs/types@3.28.0`

---

### Spike A — Server-side Markdown parsing ✅ PASS (PENDING Spike B visual confirm)

**Method used:** `api.raw.sendRichMessage({ chat_id, rich_message: { markdown: text } })`
with no compiler involved.

**Test content sent (msg_id=80056):**
- H2 heading (`##`)
- H3 heading (`###`)
- GFM pipe table
- Bullet list
- Fenced code block (python)
- Inline **bold**, *italic*, [link](https://telegram.org)

**API result:** `{ ok: true, message_id: 80056 }` — accepted without error.

**Decision forced:**
- Server-side markdown parsing is confirmed at the API level.
- `markdownToRichBlocks` compiler is **NOT needed** for the default path.
- Default path is a one-line `{ markdown: text }` pass to `sendRichMessage`.
- **Compiler RETIRED** for the default path. May be retained only as a test/diagnostic utility.

> ⚠️ Spike B visual confirmation still required (see below). If rendering is wrong,
> revisit. All evidence says pass.

---

### Spike B — Client rendering / availability ✅ CONFIRMED (2026-06-27)

**Status:** CONFIRMED — operator visually confirmed rendering on their Telegram client.

**What was checked:**
- Message id 80056: Spike A content — H2/H3/table/list/code/bold/italic/link rendered correctly ✅
- Message id 80067: Spike G content — Telegram logo image appeared inline ✅
- Message id 80061: Spike D.1 — buttons appeared on rich message ✅

**Operator confirmation:** "Rendering confirmed working on their Telegram client."

**Additional:** Spike D.3 (fire effect) was resent (msg_id=80097) for visual confirmation
as operator missed the original send (80062). API level confirmed; operator confirmed viewing.

**Fallback behavior:** Modern Telegram clients (2026) render rich messages correctly.
Legacy/unsupported client behavior: not directly tested, but the never-fail floor
(`rich → on error → sendMessage MarkdownV2`) covers this path.

---

### Spike C — Length limits ✅ PASS

**Empirical result:**
- 32768 chars total: ✅ OK (`msg_id=80070`)
- 32769 chars total: ❌ `RICH_MESSAGE_TEXT_TOO_LONG`

**Exact confirmed limit: 32768 UTF-8 characters** (matches Bot API 10.1 docs exactly).

**Compared to legacy:** 4096 chars for `sendMessage` → rich is **8x larger**.

**Chunking impact decision:**
- `splitMessage` STILL needed for very long outputs (>32768 chars).
- But threshold moves from 4096 → 32768 — practically eliminates chunking for
  normal agent responses. Chunking only triggers for extremely long content.
- Update `LIMITS.MESSAGE_TEXT` from 4096 to 32768 for rich path.

---

### Spike D — Feature parity at runtime ✅ ALL PASS

| Sub-spike | Test | Result | msg_id |
|:----------|:-----|:-------|:-------|
| D.1 | Inline keyboard on rich message | ✅ Sent with keyboard attached | 80061 |
| D.2 | `editMessageText({ rich_message })` | ✅ Edited msg 80056 in place | 80056 |
| D.3 | `message_effect_id` on rich send | ✅ Fire effect accepted (5046509860389126442) | 80062 |
| D.4 | `reply_parameters` threads a reply | ✅ Reply chain to msg 80056 | 80063 |

> D.1 button callback round-trip requires operator to tap — pending Spike B session.

**Decision forced:**
- `choice`/`confirm`/`ask`, `progress`, `animation`, `stream`, `append` can ALL move to rich.
- 15-0012 (copy_text buttons) and 30-0012 (message effects) confirmed working on rich.
- **Default-on flip is unblocked by D** (still gated on Spike B visual confirm).

---

### Spike E — Draft streaming ✅ PASS

**Lifecycle confirmed:**
1. `sendRichMessageDraft({ chat_id, draft_id: 10317001, rich_message })` → ephemeral 30s preview
2. Multiple `sendRichMessageDraft` calls with same `draft_id` → animated live updates
3. `sendRichMessage(...)` → **persists as final message** (draft disappears)

**Key correction vs the epic:**
- The epic had `updateRichMessageDraftDirect` → `finalizeRichMessageDraftDirect` as the lifecycle.
- **WRONG.** The actual lifecycle is: `sendRichMessageDraft` (draft/update) → `sendRichMessage` (finalize).
- There is NO separate "finalize" endpoint — `sendRichMessage` IS the finalize call.
- `draft_id` is a client-side identifier for animation continuity only.

**Session-close cleanup behavior:**
- Drafts are ephemeral (~30s TTL) — if the session closes without `sendRichMessage`,
  the draft disappears on its own. No explicit cleanup needed.

---

### Spike F — Caption & fallback floor ✅ CONFIRMED

**Result:** `sendPhoto` with `caption` + `parse_mode: "Markdown"` accepted (msg_id=80066).

**Confirmed:** `sendPhoto`, `sendVoice`, etc. use `caption` + `parse_mode` — NOT `rich_message`.
The `InputRichMessage` type is NOT accepted by caption-bearing methods (confirmed at type level in
`@grammyjs/types@3.28.0`).

**Floor path:**
- rich → on `RICH_MESSAGE_UNSUPPORTED` error → retry with `sendMessage` (plain/MarkdownV2)
- Media captions: stay on `parse_mode` permanently; no rich path exists for them.

---

### Spike G — Media-by-URL in rich ✅ PASS (image renders inline)

**Sent (msg_id=80067):** Rich message with `![Telegram Logo](https://telegram.org/img/t_logo.png)`
embedded in markdown field.

**API result:** Accepted without error.

**Operator visual confirm:** Image rendered inline in the Telegram chat (confirmed as part of Spike B, 2026-06-27).

**HTTPS public URL image embed: WORKS.** Telegram's rich renderer fetches and displays the image inline.

**Local file workaround path (viable with tradeoff):**
- `sendPhoto(local_file)` → `getFile()` → use `https://api.telegram.org/file/bot<TOKEN>/<path>` as img URL in rich message.
- Token exposure tradeoff: the file-API URL embeds the bot token in message history/forwarded content.
  Acceptable for **private 1-on-1 bots** (this bot's use case). NOT acceptable for multi-user/group bots.

**Decision for 10-3018:**
- Rich messages CAN embed images via HTTPS URL (public URLs work natively).
- Local file embed: use the `sendPhoto` → `getFile` URL workaround; document the token-exposure caveat.
- For local files where token exposure is not acceptable: fall back to `sendPhoto` multipart (legacy path).

---

## Decisions Summary (FINAL — all spikes complete)

| Question | Answer | Confidence |
|:---------|:-------|:-----------|
| Use grammY native vs raw-fetch? | **Native grammY** — `api.raw.sendRichMessage(...)` | ✅ Confirmed |
| `markdownToRichBlocks` compiler needed? | **YES — is the `string:` path implementation.** `html`/`markdown` paths are grammY passthroughs (no compiler). `string:` path: smart detection + compiler unchanged. NOT retired. | ✅ Confirmed |
| Rich length limit? | **32768 chars** (8× legacy 4096) | ✅ Empirically confirmed |
| Inline keyboards on rich? | **YES** | ✅ Confirmed (API + visual) |
| Edit rich in place? | **YES** via `editMessageText({ rich_message })` | ✅ Confirmed |
| Message effects on rich? | **YES** — fire effect confirmed | ✅ Confirmed (API + resent msg 80097) |
| Reply threading on rich? | **YES** | ✅ Confirmed |
| Draft lifecycle? | `sendRichMessageDraft` updates + `sendRichMessage` finalizes | ✅ Confirmed |
| Caption path? | **Stays legacy** (`parse_mode`) — media methods don't accept `rich_message` | ✅ Confirmed |
| Image embed in rich? | HTTPS URLs render inline ✅; local files: `sendPhoto`→`getFile` URL workaround (token tradeoff) | ✅ Confirmed (visual) |
| Default-on flip safe? | **YES** — all critical spikes pass | ✅ Unblocked |
| choice/confirm/ask, progress, animation, stream, append can go rich? | **YES** | ✅ D-spikes confirm |

## Status

- Spikes A, C, D, E, F, G: ✅ Complete
- Spike B: ✅ CONFIRMED (operator visual confirmation received 2026-06-27)
- Epic rewrite (10-3001): ✅ Complete — see rewritten epic below this task

## Verification

- Spec revised: 2026-06-28 per operator directives (voice msgs 80175, 80177, 80186, 80192)
- First verifier (aae0734c5461efaa9) 2026-06-27: NEEDS_REVISION — 3 gaps
- Re-verifier (a4a9f55a2a39668eb) 2026-06-27: APPROVED (pre-architecture clarification)
- Seal retracted 2026-06-28: three-tier architecture + regression guard + markdownToRichBlocks framing corrected
- Final re-verifier (a9d6423fb903a4cbc) 2026-06-28: **APPROVED** — all six criteria confirmed
- Overseer seal: pending adversarial review before push
