# Bot API 10.1 "Rich Messages" — TMCP Research Report

**Date:** 2026-06-11  
**Author:** Curator (research agent)  
**Status:** Idea / Pre-proposal  
**Sources verified against:** https://core.telegram.org/bots/api-changelog (June 11, 2026)

---

## Executive Summary

Telegram Bot API 10.1 (released June 11, 2026 — the same day as this report) introduces "Rich Messages": a structured block-based message format with headings, tables, collapsible sections, lists, LaTeX, slideshows, maps, and more. This is a **fundamentally different API surface** from `sendMessage` with `parse_mode`. The installed grammY (v1.43.0, targeting Bot API 10.0) has **zero support** for these new types as of the report date. TMCP's translation engine would need significant extension to use them, but the UX payoff is high for an agent→operator messaging bridge.

---

## 1. What Did Bot API 10.1 Add?

### 1.1 Overview

Bot API 10.1 (June 11, 2026) added **Rich Messages**: a new class of highly structured bot messages, analogous to Telegram's own Instant View articles. This is not an extension of `parse_mode` — it is a new parallel sending path via new methods.

**New methods:**
- `sendRichMessage` — send a fully structured rich message
- `sendRichMessageDraft` — stream a rich message incrementally (AI-generation-native)
- `editMessageText` — extended with a `rich_message` parameter for editing rich messages

**New types (22+ RichText inline formatters):**

| Category | Types |
|---|---|
| Basic inline | RichTextBold, RichTextItalic, RichTextUnderline, RichTextStrikethrough, RichTextSpoiler |
| Special inline | RichTextSubscript, RichTextSuperscript, RichTextMarked, RichTextCode, RichTextCustomEmoji |
| Math / time | RichTextMathematicalExpression, RichTextDateTime |
| Links / social | RichTextUrl, RichTextEmailAddress, RichTextPhoneNumber, RichTextBankCardNumber |
| Telegram entities | RichTextMention, RichTextTextMention, RichTextHashtag, RichTextCashtag, RichTextBotCommand |
| Navigation | RichTextAnchor, RichTextAnchorLink, RichTextReference, RichTextReferenceLink |

**New types (21 RichBlock structural blocks):**

| Block | Purpose |
|---|---|
| RichBlockParagraph | Body text paragraph |
| RichBlockSectionHeading | Section heading (multi-level) |
| RichBlockPreformatted | Code block |
| RichBlockFooter | Footer text |
| RichBlockDivider | Horizontal rule |
| RichBlockMathematicalExpression | LaTeX / math block |
| RichBlockList | Ordered or unordered list |
| RichBlockBlockQuotation | Block quote |
| RichBlockPullQuotation | Pull quote (callout style) |
| RichBlockTable | Full table with cells |
| RichBlockDetails | Expandable/collapsible section |
| RichBlockAnchor | Named anchor |
| RichBlockCollage | Multi-image collage |
| RichBlockSlideshow | Image slideshow / carousel |
| RichBlockMap | Embedded map |
| RichBlockAnimation | Embedded GIF/animation |
| RichBlockAudio | Embedded audio |
| RichBlockPhoto | Embedded photo |
| RichBlockVideo | Embedded video |
| RichBlockVoiceNote | Embedded voice note |
| RichBlockThinking | AI "thinking" block (special UX for reasoning) |

**Supporting types:** `RichMessage`, `RichBlock`, `RichText`, `RichBlockCaption`, `RichBlockTableCell`, `RichBlockListItem`, `InputRichMessage`, `InputRichMessageContent`.

### 1.2 What Can Bots Actually Use?

Based on the changelog, `sendRichMessage` and `sendRichMessageDraft` are **bot API methods** (listed under the Bot API, not client-only). These are designed explicitly for bots — the word "bots" appears in the description: "allowing bots to send rich messages." `sendRichMessageDraft` is specifically designed for AI-generated streaming replies, which is directly relevant to TMCP.

The `InputRichMessageContent` type is also allowed as `InputMessageContent` in inline/Web App queries, meaning rich messages can be sent from inline mode too.

**Important uncertainty:** The detailed field-level spec (exact required/optional fields for each block type) was not obtainable from the live docs at report time — the documentation appears newly published and the individual anchor sections were returning truncated responses. The structure is architecturally analogous to TDLib's `PageBlock` system (which powers Instant View), which is well-documented and has nearly identical block names (`pageBlockParagraph`, `pageBlockHeader`, `pageBlockTable`, etc.). This gives strong confidence in the structural semantics even without the field spec.

### 1.3 Bot API 9.x Formatting Additions (Prior Context)

- **Bot API 9.5** (March 1, 2026): New `MessageEntity` type `"date_time"` for displaying localized formatted date/time.
- **Bot API 7.4** (May 28, 2024): `"expandable_blockquote"` entity type — collapsible block quote in `sendMessage` (MarkdownV2/HTML).
- **Bot API 7.0** (December 29, 2023): `"blockquote"` entity type.

**Note:** `sendMessage` with `parse_mode` still exists and is unchanged. Rich Messages are an additive parallel path, not a replacement.

---

## 2. Feature-by-Feature: What Can Bots Render Now?

| Feature | Bot API Mechanism | Available in `sendMessage`? | Available in `sendRichMessage`? |
|---|---|---|---|
| Tables | `RichBlockTable` + `RichBlockTableCell` | No | Yes |
| Multi-level headings | `RichBlockSectionHeading` | No | Yes |
| Collapsible/expandable blocks | `RichBlockDetails` | No | Yes |
| Expandable block quotes | `expandable_blockquote` entity | Yes (Bot API 7.4) | Yes (as RichBlockBlockQuotation) |
| LaTeX / math | `RichBlockMathematicalExpression`, `RichTextMathematicalExpression` | No | Yes |
| Ordered/unordered lists | `RichBlockList` + `RichBlockListItem` | No | Yes |
| Code blocks | `RichBlockPreformatted` | Yes (via `pre` entity) | Yes |
| Image slideshows | `RichBlockSlideshow` | No | Yes |
| Embedded maps | `RichBlockMap` | No | Yes |
| Pull quotes | `RichBlockPullQuotation` | No | Yes |
| AI thinking blocks | `RichBlockThinking` | No | Yes |
| Streaming/draft mode | `sendRichMessageDraft` | No | Yes |
| Subscript/superscript | `RichTextSubscript` / `RichTextSuperscript` | No | Yes |

---

## 3. Concrete UX Benefits for an Agent→Operator Bridge (TMCP)

TMCP's primary use case is agent→operator communication: status updates, task summaries, build results, plan proposals, checklists, and error reports. Rich Messages directly improve every one of these:

1. **Tables**: Agent can send a structured result table (e.g., test results: pass/fail/skip per module) as a real rendered table instead of ASCII art or code-block hacks.

2. **Section headings**: Long agent reports (plan proposals, research summaries) become scannable with real H1/H2/H3-equivalent headings, not just bold text workarounds.

3. **Collapsible sections (`RichBlockDetails`)**: Agent can send a compact summary with an expandable detail block. Example: "3 issues found [tap to expand]" → full diagnostic. This is huge for mobile UX since the operator often checks Telegram on phone.

4. **`RichBlockThinking`**: Specifically designed for AI reasoning output. TMCP could expose this for agents that want to surface a "thinking summary" separate from the final answer.

5. **`sendRichMessageDraft` streaming**: TMCP currently implements streaming via `stream/start` → `stream/chunk` → `stream/flush` using repeated `editMessageText` calls (see `src/tools/send/stream.ts`). `sendRichMessageDraft` is native streaming with rich structure — could replace the brittle edit-based approach with a first-class API.

6. **LaTeX for mathematical agents**: If any agent is doing math, numerical analysis, or stats, LaTeX blocks render properly in the Telegram client.

7. **Lists**: Agent can send a properly formatted bulleted or numbered list (task plan, options, checklist) instead of using Unicode bullet hacks (`• item`).

---

## 4. grammY Support Status

**Installed version:** grammY `^1.43.0` (resolved to `1.43.0`)  
**Bot API version supported by v1.43.0:** Bot API **10.0**  
**Bot API 10.1 support:** **NOT present**

Verified by grepping the installed `node_modules/grammy` package for `sendRichMessage`, `InputRichMessage`, `RichBlock`, `RichText` — zero matches found.

grammY's latest release as of report date is v1.43.0 (May 16, 2026). Bot API 10.1 was released the same day as this report (June 11, 2026). grammY typically tracks Bot API updates within weeks, but as of today there is no grammY release that covers 10.1.

**Implication:** To use `sendRichMessage` today, TMCP would need to call the Telegram Bot API directly via `fetch` (the same pattern used in `sendVoiceDirect` in `src/telegram.ts` lines 533–631), bypassing grammY. Once grammY ships a 10.1-compatible release, it can be migrated to native grammY calls.

---

## 5. How TMCP Currently Formats Messages

### 5.1 The Translation Engine (`src/markdown.ts`)

TMCP has a single central translation file: `src/markdown.ts`. It is the "Markdown→MarkdownV2 translation engine." Key functions:

- **`escapeV2(s)`** (line 32): Escapes all MarkdownV2 special characters.
- **`escapeHtml(s)`** (line 36): Escapes HTML special characters.
- **`resolveParseMode(text, parseMode)`** (line 44): If `parse_mode === "Markdown"`, calls `markdownToV2()` and returns `parse_mode: "MarkdownV2"`. Otherwise passes through. This is the main entry point.
- **`markdownToV2(input, partial)`** (line 54): The core translation function. Converts standard Markdown to Telegram MarkdownV2 format. Handles:
  - Fenced code blocks (verbatim extraction, partial/streaming mode)
  - Transport escape sequence normalization (`\n`, `\"`, `\\`)
  - Blockquote lines (`> text` → `>escaped_text`)
  - ATX headings (`# Heading` → `*Heading*` — i.e., bold, not a real heading)
  - Bold (`**text**` → `*text*`, `*text*` → `*text*`)
  - Italic (`_text_` → `_text_`)
  - Underline (`__text__` → `__text__`)
  - Strikethrough (`~~text~~` → `~text~`)
  - Inline links (`[text](url)` → `[text](url)`)
  - Inline code (`` `text` `` → verbatim)
  - Plain text escaping (all MarkdownV2 specials escaped)

**Key limitation at line 92:** ATX headings are downgraded to bold: `# Heading` → `*Heading*`. There is no structural heading in the current output.

### 5.2 How parse_mode flows through tools

1. Agent calls a send tool (e.g., `notify`, `send`, `stream/start`) with `parse_mode: "Markdown"` (the default).
2. Tool calls `resolveParseMode(text, parse_mode)` from `src/markdown.ts`.
3. `resolveParseMode` calls `markdownToV2(text)` and returns `{ text: converted, parse_mode: "MarkdownV2" }`.
4. Tool calls `getApi().sendMessage(chatId, text, { parse_mode: "MarkdownV2" })`.
5. The outbound proxy (`src/outbound-proxy.ts`) intercepts `sendMessage`, injects a multi-session name tag header if needed, then calls the real Grammy API.

This pipeline applies to: `notify` (src/tools/send/notify.ts), `append_text` (src/tools/send/append.ts), `stream/start` and `stream/chunk` (src/tools/send/stream.ts), and the primary send tools.

The proxy handles: typing cancel, temp message expiry, animation promotion, session name tag injection, outgoing message recording, one-shot send notifiers.

### 5.3 No existing Rich Message path

The codebase has no `sendRichMessage`, `RichBlock`, or `InputRichMessage` anywhere. The only non-grammY API call is `sendVoiceDirect` in `src/telegram.ts`, which uses raw `fetch`. This is the exact pattern a new `sendRichMessage` implementation would follow.

---

## 6. Extension Proposals for the Translation Engine

### 6.1 Short-term: sendRichMessage via raw fetch (no grammY dependency)

Add a `sendRichMessageDirect(chatId, inputRichMessage, options)` function in `src/telegram.ts` following the same pattern as `sendVoiceDirect`. This would let TMCP use Bot API 10.1 features immediately without waiting for grammY to ship a compatible release.

```typescript
// Proposed signature (src/telegram.ts)
export async function sendRichMessageDirect(
  chatId: number,
  richMessage: InputRichMessage,
  options?: { disable_notification?: boolean; reply_to_message_id?: number }
): Promise<{ message_id: number }>
```

The `InputRichMessage` type would be locally defined (a TS interface matching the Bot API spec) until grammY ships types for it.

### 6.2 Medium-term: Markdown→RichBlock compiler

Extend `markdownToV2` (or create a parallel `markdownToRichBlocks` function) that parses Markdown and emits an `InputRichMessage` with `RichBlock[]` instead of an escaped string. This would be a proper AST-based approach:

- `# H1` → `RichBlockSectionHeading` (level 1)
- `## H2` → `RichBlockSectionHeading` (level 2)  
- `| col | col |` table syntax → `RichBlockTable` + `RichBlockTableCell[]`
- `- item` / `1. item` → `RichBlockList` + `RichBlockListItem[]`
- ` ```lang\ncode\n``` ` → `RichBlockPreformatted`
- `> quote` → `RichBlockBlockQuotation`
- `:::details Title\ncontent\n:::` (extended syntax) → `RichBlockDetails`
- `$$formula$$` (LaTeX) → `RichBlockMathematicalExpression`

The agent-facing API would remain identical: agent sends Markdown, TMCP picks the best rendering path.

### 6.3 Medium-term: New `send_rich` MCP tool

Add a new `send_rich` tool alongside `send`, `notify`, and the stream tools. It would accept structured input (blocks, not raw Markdown) and call `sendRichMessage`. Agents that want fine-grained control over headings/tables/details can use it directly.

### 6.4 Low-hanging: Expose RichBlockThinking in streaming

The `sendRichMessageDraft` method is specifically designed for AI-generated streaming. TMCP's current `stream/start → stream/chunk → stream/flush` pattern could be complemented with a `stream/rich` variant that uses `sendRichMessageDraft` natively, providing better Telegram-native UX for streaming agent output (including the `RichBlockThinking` block for reasoning steps).

---

## 7. Effort vs. Value Prioritization

| Priority | Feature | Effort | Value | Dependency |
|---|---|---|---|---|
| 1 | `sendRichMessageDirect` raw-fetch helper | Low | Unlocks all below | None — raw fetch today |
| 2 | Table rendering (Markdown GFM → RichBlockTable) | Medium | Very high (most-requested missing feature) | #1 |
| 3 | Section headings (# → RichBlockSectionHeading) | Low | High (replaces bold workaround) | #1 |
| 4 | Lists (- / 1. → RichBlockList) | Low | High (proper list rendering) | #1 |
| 5 | Collapsible blocks (RichBlockDetails) | Medium | High (mobile UX — fold long reports) | #1 |
| 6 | `sendRichMessageDraft` streaming replacement | High | High (native streaming, fewer edits) | #1 + grammY 10.1 types |
| 7 | LaTeX math blocks | Low | Medium (niche but clean) | #1 |
| 8 | RichBlockThinking exposure | Medium | Medium (agent reasoning UX) | #1 |
| 9 | Full Markdown→RichBlocks compiler | High | Very high long-term | #1 + spec completeness |
| 10 | grammY upgrade to 10.1 when available | Low | Enables native types | grammY release |

**Recommended first step:** Build `sendRichMessageDirect` (item #1) as a thin raw-fetch wrapper in `src/telegram.ts`. This is a ~50-line addition following the existing `sendVoiceDirect` pattern. It unblocks everything else without touching the translation engine.

**Recommended second step:** Add a `send_rich` tool with a flat `blocks` parameter so agents can hand-craft structured content. This validates the API contract before building the Markdown compiler.

**Recommended third step (after grammY 10.1):** Replace raw fetch with grammY native calls and build the Markdown→RichBlocks compiler.

---

## 8. Uncertainties and Caveats

1. **Field-level spec not fully verified:** The detailed `InputRichMessage` field definitions (required/optional, exact field names) were not obtainable from the live docs at report time (docs appear newly published; pages truncated on fetch). The structural design is inferred from the changelog + TDLib PageBlock analogy. **Before implementing, verify the exact schema from `https://core.telegram.org/bots/api#inputrichmessage`.**

2. **grammY support timeline:** grammY typically ships Bot API support within 2–4 weeks of a release. Watch the grammY releases page. The raw-fetch approach is a bridge, not the long-term path.

3. **Client support:** Rich Messages render as structured content in Telegram clients. Older clients may show a fallback. The Bot API changelog does not specify a minimum client version. Test on current iOS/Android Telegram before shipping to production.

4. **`sendMessage` unchanged:** The existing translation engine and all existing tools remain valid. Rich Messages are additive. No migration needed.

5. **`RichBlockThinking`:** This block type is novel and its rendering semantics are unverified. It may require special permissions or be gated on certain bot configurations.

---

## 9. Key File References

| File | Relevance |
|---|---|
| `src/markdown.ts` | Translation engine: `markdownToV2`, `resolveParseMode`, `escapeV2`, `escapeHtml` |
| `src/telegram.ts` lines 533–631 | `sendVoiceDirect` — the pattern for raw-fetch API calls (template for `sendRichMessageDirect`) |
| `src/outbound-proxy.ts` | Proxy intercepting `sendMessage`/`editMessageText`; new rich send methods would need proxy hooks |
| `src/tools/send/stream.ts` | Current streaming implementation (edit-based; `sendRichMessageDraft` is the native replacement) |
| `src/tools/send/notify.ts` | Primary notification tool — biggest UX gain from headings + tables |
| `src/tools/send/append.ts` | Edit-based append; compatible with rich message edits via `editMessageText` `rich_message` param |
| `package.json` line 59 | `"grammy": "^1.43.0"` — current version, supports Bot API 10.0 only |

---

## Sources

- Telegram Bot API Changelog: https://core.telegram.org/bots/api-changelog
- Telegram Bot API Reference: https://core.telegram.org/bots/api
- TDLib PageBlock (structural analogy): https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1_page_block.html
- TDLib RichText (inline text analogy): https://core.telegram.org/tdlib/docs/classtd_1_1td__api_1_1_rich_text.html
- grammY releases: https://github.com/grammyjs/grammY/releases
- grammY npm: https://www.npmjs.com/package/grammy
