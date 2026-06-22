---
Created: 2026-06-11
Updated: 2026-06-11
Status: Draft
Host: local
Priority: Low
Source: Operator (voice, 2026-06-11)
Target: V8 (flexible — may slip to 7.11)
---

# V8 Rich Messages Markup — Bot API 10.1 Auto-Translation

## Objective

TMCP auto-translates the Markdown that agents already write into Telegram's
new Bot API 10.1 "Rich Messages" block format — tables, multi-level headings,
ordered/unordered lists, collapsible detail sections, LaTeX math, location
maps, media slideshows, and streaming draft updates — without losing a single
capability that exists today.

**Success criterion:** lose nothing, gain everything. Every message that renders
correctly today must continue to render correctly after this change. Every new
10.1 feature available via `sendRichMessage` / `sendRichMessageDraft` must be
reachable through the ordinary Markdown-in, rich-message-out pipeline.

Operator directive (2026-06-11, distilled): agents write standard Markdown;
TMCP decides whether to send a legacy `parse_mode` message or a Bot API 10.1
rich-block message. The upgrade is invisible to callers.

## Scope

### 1. Preserve all current functionality

The following must continue to work exactly as documented in `docs/formatting.md`
and implemented in `src/markdown.ts` after any changes in this epic:

- **`resolveParseMode` pipeline** — the `Markdown` → `MarkdownV2` auto-conversion
  entry point used by every send path. All inline constructs it handles today
  (bold `**` / `*`, italic `_`, underline `__`, strikethrough `~~`, inline code,
  fenced code blocks, blockquotes `>`, ATX headings `# … ######`, hyperlinks
  `[text](url)`) must survive unchanged.
- **`parse_mode: "MarkdownV2"` pass-through** — callers who manually escape
  MarkdownV2 and pass the mode explicitly must not be intercepted.
- **`parse_mode: "HTML"` pass-through** — HTML-formatted messages must not be
  touched.
- **Plain-text (no `parse_mode`) path** — passes through unmodified.
- **All existing send methods** in `src/telegram.ts`: `sendMessage`, chunking
  logic (4096-char limit), animation/sticker/document/photo sends,
  `sendVoiceDirect` (raw-fetch pattern), reaction recording, rate-limiter
  integration, and all downstream paths that call `resolveParseMode`.
- **Notification tool** (`send(type: "notification")`) — including title-always-bold
  and severity behavior.
- **Session header injection** via `outbound-proxy.ts`.
- **Partial/streaming mode** in `markdownToV2` (the `partial = true` flag for
  draft updates) — must have a direct counterpart in the rich-message path.

### 2. Bot API 10.1 features to gain

Telegram Bot API 10.1 (released ~June 2026) introduced a new first-class rich
message type. The full feature surface to expose through TMCP:

| Feature | Bot API construct (inferred — verify at core.telegram.org/bots/api) |
|---|---|
| Multi-level headings (H1–H6) | `RichBlock` of type `heading` with `level` field |
| Ordered and unordered lists | `RichBlock` of type `list` / `ordered_list` |
| Tables | `RichBlock` of type `table` with header row and cell array |
| Collapsible / expandable sections | `RichBlock` of type `details` (title + body blocks) |
| LaTeX math (inline and display) | `RichBlock` of type `math` / `inline_math` |
| Location map embed | `RichBlock` of type `location` |
| Media slideshow | `RichBlock` of type `slideshow` |
| Rich text paragraph | `RichBlock` of type `paragraph` with `entities` |
| Code block (language-tagged) | `RichBlock` of type `code` with `language` |
| Streaming / live draft | `sendRichMessageDraft` + `updateRichMessageDraft` → `finalizeRichMessageDraft` |

**Schema caveat:** exact field names, nesting rules, and required/optional
properties for `InputRichMessage` and every `RichBlock` variant have NOT been
verified against live documentation as of 2026-06-11. The API was freshly
published. All field-level details in this epic are inferred from the Telegram
changelog and community reports — they MUST be verified against
`core.telegram.org/bots/api` before any implementation begins. Do not treat
the table above as a normative schema reference.

**grammY gap:** grammy `^1.43.0` (current dependency) does not expose
`sendRichMessage` or `sendRichMessageDraft`. A grammY release that wraps 10.1
is not yet available. The implementation must not wait for grammY.

### 3. Raw-fetch `sendRichMessageDirect` — bypassing grammY

Model the new sender directly on `sendVoiceDirect` in `src/telegram.ts`
(~line 533). That function demonstrates the established pattern for calling
Bot API endpoints that grammY doesn't support:

- Read `BOT_TOKEN` from `process.env`.
- Build the request body as JSON (or `FormData` if attachments are needed).
- Call the Bot API endpoint via native `fetch`.
- Handle error responses and map them to the existing `TelegramError` type.

A new `sendRichMessageDirect(chatId, blocks, options)` function should be added
to `src/telegram.ts` following the same conventions:

- `blocks: RichBlock[]` — the compiled block array.
- `options` — at minimum: `disable_notification`, `reply_to_message_id`,
  session header injection point.
- Returns `{ message_id: number }` (same shape as other senders).

A companion `updateRichMessageDraftDirect` and `finalizeRichMessageDraftDirect`
are needed to support streaming.

No grammY type imports for 10.1 types — define minimal local TypeScript
interfaces for `RichBlock` variants, verified against the live API docs.

### 4. Markdown → RichBlocks compiler (core of the epic)

The heart of the epic is a new compilation stage that sits between the existing
`markdownToV2` function and the send path. Working title: `markdownToRichBlocks`.

**Design:**

1. Parse the input Markdown into a block AST:
   - ATX headings `#`–`######` → heading blocks with level.
   - Fenced code blocks → code blocks with language.
   - GFM tables (`| col | col |` syntax) → table blocks.
   - `<details>`/`<summary>` HTML or a Markdown convention TBD → details blocks.
   - Ordered lists (`1. item`) and unordered lists (`- item`, `* item`) → list blocks.
   - `$$…$$` / `$…$` LaTeX delimiters → math blocks.
   - Remaining paragraphs → paragraph blocks with inline entity extraction (bold, italic, code, links, strikethrough, underline) using existing escape/tokenizer logic.

2. Output: `RichBlock[]` ready for `sendRichMessageDirect`.

3. **Graceful fallback:** if any parse step produces a construct that cannot be
   represented in 10.1 blocks (e.g., features not yet supported), or if
   `sendRichMessageDirect` returns an error indicating the bot lacks 10.1
   access, fall back transparently to the today's `resolveParseMode` →
   MarkdownV2 / HTML path. The caller never sees the difference.

4. **Feature detection gate:** expose an env var or config flag
   (e.g., `RICH_MESSAGES=true`) so operators can enable 10.1 output
   incrementally. Default off until the path is fully validated.

5. **Partial/streaming mode:** `markdownToRichBlocks(input, partial = true)`
   must produce valid intermediate block arrays as the Markdown grows, the same
   way `markdownToV2` handles unclosed spans today. This feeds
   `updateRichMessageDraftDirect` for live streaming updates.

### 5. Routing logic

A thin router sits at the top of each outbound send path:

```
if (RICH_MESSAGES enabled && parse_mode === "Markdown" || parse_mode undefined)
  → markdownToRichBlocks → sendRichMessageDirect
else
  → resolveParseMode → existing send path (unchanged)
```

`parse_mode: "MarkdownV2"` and `parse_mode: "HTML"` always bypass the rich
path — callers who opt into manual modes get what they asked for.

The router must be added at the `send` / `sendMessage` boundary, not inside
`resolveParseMode`, so that `resolveParseMode` remains a self-contained,
testable function with no change to its signature or behavior.

### 6. Phased rollout

Each phase is independently mergeable and testable.

| Phase | Deliverable |
|---|---|
| **Phase 1** | `sendRichMessageDirect` + `updateRichMessageDraftDirect` + `finalizeRichMessageDraftDirect` raw-fetch helpers in `src/telegram.ts`. No routing yet — callable only via internal test or an explicit `type: "rich"` action. Schema validated against live API. |
| **Phase 2** | `markdownToRichBlocks` compiler: headings, paragraphs with inline entities, fenced code, unordered/ordered lists. Tables and details deferred. Routing gate behind `RICH_MESSAGES=true` env var. |
| **Phase 3** | Tables, collapsible `details` blocks, LaTeX math. Update `docs/formatting.md` to document new Markdown syntax that triggers rich blocks. |
| **Phase 4** | Streaming integration: `partial = true` path through `updateRichMessageDraftDirect` for draft messages. Tie into existing streaming/notification flows. |
| **Phase 5** | Location map and slideshow block support (dependent on TMCP gaining corresponding send tools). Full compiler coverage. Remove `RICH_MESSAGES` gate; enable by default. Update help topics and `docs/help/` accordingly (integrates with epic 10-2107). |

Phases 1–3 are V8 candidates. Phases 4–5 may slip to 7.11 or a subsequent
minor if the 10.1 schema proves more complex than anticipated.

### 7. Open questions and risks

**Schema verification (BLOCKING for Phase 1):**
The exact field names, required/optional fields, nesting depth limits, and
character/size limits for `InputRichMessage`, `sendRichMessage`,
`sendRichMessageDraft`, and all `RichBlock` subtypes have not been verified
from the live `core.telegram.org/bots/api` documentation as of 2026-06-11.
Implementation must begin with a documentation verification pass and produce a
`docs/rich-message-schema.md` snapshot of the confirmed field set before any
code is written.

**Telegram app version requirements:**
10.1 rich messages likely require a minimum client app version to render
correctly. Older clients may fall back to a text representation or show an
error. TMCP cannot control what version clients run. The fallback path (Phase 2
grace fallback) mitigates this, but the operator experience on older clients
should be documented.

**grammY type conflicts:**
When grammY eventually releases 10.1 support, local `RichBlock` interface
definitions will conflict with grammY's types. The local interfaces should be
in a dedicated `src/types/rich-message.ts` file, easy to replace with grammY
imports in a single edit.

**Streaming timing and draft lifecycle:**
`sendRichMessageDraft` implies a draft-ID lifecycle (create → update → finalize).
Draft IDs must be tracked per send call. If a TMCP session closes before
`finalizeRichMessageDraftDirect` is called, the draft may linger in the client.
Session-close cleanup logic may need updating.

**Bot API 10.1 availability:**
At time of writing (2026-06-11), Bot API 10.1 is newly released. The endpoint
may not yet be available on all Telegram Bot API server configurations (e.g.,
local bot API servers). This should be tested before Phase 1 is marked complete.

**GFM table detection in existing content:**
`markdownToV2` currently escapes `|` characters as `\|` in MarkdownV2 plain
text. The new compiler must detect that a line block is an intentional table
(pipe-aligned header row + separator row) vs. prose containing `|`. Misdetection
would silently corrupt output.

### 8. Out of scope

- Changes to `parse_mode: "MarkdownV2"` or `parse_mode: "HTML"` behavior.
- Changes to the voice/TTS pipeline (`sendVoiceDirect`), file send paths,
  animation, sticker, or photo send paths — these are untouched.
- A new MCP tool specifically for raw `RichBlock[]` composition (agents write
  Markdown; direct block assembly is a possible future tool, not part of this epic).
- Per-block inline keyboard / button attachments (separate backlog item).
- Rendering on Telegram Web or desktop — TMCP sends via Bot API only; client
  rendering is Telegram's responsibility.
- Updating the help topic coverage or help index — that work belongs to epic
  10-2107. Phase 5 of this epic produces the new formatting docs; 10-2107 wires
  them into `help()`.

## Acceptance criteria

- [ ] `sendRichMessageDirect` successfully sends a 10.1 rich message via raw fetch;
      verified against live Bot API.
- [ ] `markdownToRichBlocks` correctly compiles headings, paragraphs, code blocks,
      lists, and tables from standard Markdown input.
- [ ] Every message type that renders correctly today continues to render correctly
      with `RICH_MESSAGES=false` (default).
- [ ] With `RICH_MESSAGES=true`, a Markdown message containing an H2, a GFM table,
      a fenced code block, and a bullet list renders as a rich message in Telegram.
- [ ] `parse_mode: "MarkdownV2"` and `parse_mode: "HTML"` callers are not affected.
- [ ] Fallback to MarkdownV2 is exercised and confirmed when `sendRichMessageDirect`
      returns a 10.1-unavailable error.
- [ ] `docs/rich-message-schema.md` exists and contains confirmed field names from
      the live Bot API docs.
- [ ] `docs/formatting.md` updated to document which Markdown constructs trigger
      rich blocks.
- [ ] No existing tests broken; new unit tests cover `markdownToRichBlocks` for
      each block type.

## Delivery

Begin with the schema verification pass (see Open Questions §7). Phase 1 raw-fetch
helpers are a self-contained PR. Phases 2–3 build the compiler incrementally.
Background agents are appropriate for mechanical compiler work; reviewer must
diff the compiled block output against expected structures before merge.
