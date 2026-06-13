/**
 * Phase 1 Markdown → RichBlocks Compiler
 * Task: 10-3013
 *
 * Converts a Markdown string into an array of RichBlock objects
 * suitable for sending via the Telegram Bot API 10.1 sendRichMessage method.
 *
 * Never throws — any unrepresentable input is emitted as a RichBlockParagraph
 * containing the raw text.
 */
import type {
  RichBlock,
  RichText,
  RichBlockParagraph,
  RichBlockSectionHeading,
  RichBlockPreformatted,
  RichBlockList,
  RichBlockListItem,
  RichBlockBlockQuotation,
  RichTextBold,
  RichTextItalic,
  RichTextUnderline,
  RichTextStrikethrough,
  RichTextCode,
  RichTextAnchorLink,
} from "./types/rich-message.js";

// ─── Inline tokenizer ─────────────────────────────────────────────────────────

/**
 * Find the next occurrence of a single (non-doubled) delimiter character
 * starting at position `from`, up to (but not including) `end`.
 *
 * Skips over pairs of the delimiter (e.g. `**` while searching for single `*`).
 */
function findSingleDelim(
  text: string,
  delim: string,
  from: number,
  end: number,
): number {
  let i = from;
  while (i < end) {
    if (text[i] === delim) {
      if (i + 1 < end && text[i + 1] === delim) {
        i += 2; // skip doubled delimiter
      } else {
        return i;
      }
    } else {
      i++;
    }
  }
  return -1;
}

/**
 * Parse inline markdown entities within `text[start..end)`.
 *
 * Precedence (highest first):
 *   1. `[label](url)` — RichTextAnchorLink
 *   2. `` `code` ``   — RichTextCode
 *   3. `**bold**`     — RichTextBold
 *   4. `__under__`    — RichTextUnderline
 *   5. `~~strike~~`   — RichTextStrikethrough
 *   6. `*bold*`       — RichTextBold  (single-asterisk = bold per assignment spec)
 *   7. `_italic_`     — RichTextItalic
 *   8. plain text
 */
function parseInlineRange(text: string, start: number, end: number): RichText {
  const tokens: RichText[] = [];
  let i = start;
  let plainStart = i;

  /** Flush accumulated plain-text characters up to `to`. */
  function flushPlain(to: number): void {
    if (to > plainStart) {
      tokens.push(text.slice(plainStart, to));
    }
  }

  while (i < end) {
    const c = text[i];

    // ── [label](url) → RichTextAnchorLink ──────────────────────────────────
    if (c === "[") {
      const slice = text.slice(i, end);
      const m = slice.match(/^\[([^\]]*)\]\(([^)]*)\)/);
      if (m) {
        flushPlain(i);
        const node: RichTextAnchorLink = {
          type: "anchor_link",
          text: parseInline(m[1]),
          anchor_name: m[2],
        };
        tokens.push(node);
        i += m[0].length;
        plainStart = i;
        continue;
      }
    }

    // ── `code` → RichTextCode ───────────────────────────────────────────────
    if (c === "`") {
      const closeIdx = text.indexOf("`", i + 1);
      if (closeIdx !== -1 && closeIdx < end) {
        flushPlain(i);
        const node: RichTextCode = {
          type: "code",
          text: text.slice(i + 1, closeIdx),
        };
        tokens.push(node);
        i = closeIdx + 1;
        plainStart = i;
        continue;
      }
    }

    // ── **bold** → RichTextBold (double asterisk; check before single) ──────
    if (c === "*" && i + 1 < end && text[i + 1] === "*") {
      const closeIdx = text.indexOf("**", i + 2);
      if (closeIdx !== -1 && closeIdx < end) {
        flushPlain(i);
        const node: RichTextBold = {
          type: "bold",
          text: parseInline(text.slice(i + 2, closeIdx)),
        };
        tokens.push(node);
        i = closeIdx + 2;
        plainStart = i;
        continue;
      }
    }

    // ── __underline__ → RichTextUnderline (double underscore; before single) ─
    if (c === "_" && i + 1 < end && text[i + 1] === "_") {
      const closeIdx = text.indexOf("__", i + 2);
      if (closeIdx !== -1 && closeIdx < end) {
        flushPlain(i);
        const node: RichTextUnderline = {
          type: "underline",
          text: parseInline(text.slice(i + 2, closeIdx)),
        };
        tokens.push(node);
        i = closeIdx + 2;
        plainStart = i;
        continue;
      }
    }

    // ── ~~strikethrough~~ → RichTextStrikethrough ───────────────────────────
    if (c === "~" && i + 1 < end && text[i + 1] === "~") {
      const closeIdx = text.indexOf("~~", i + 2);
      if (closeIdx !== -1 && closeIdx < end) {
        flushPlain(i);
        const node: RichTextStrikethrough = {
          type: "strikethrough",
          text: parseInline(text.slice(i + 2, closeIdx)),
        };
        tokens.push(node);
        i = closeIdx + 2;
        plainStart = i;
        continue;
      }
    }

    // ── *bold* → RichTextBold (single asterisk per assignment spec) ─────────
    if (c === "*" && !(i + 1 < end && text[i + 1] === "*")) {
      const closeIdx = findSingleDelim(text, "*", i + 1, end);
      if (closeIdx !== -1) {
        flushPlain(i);
        const node: RichTextBold = {
          type: "bold",
          text: parseInline(text.slice(i + 1, closeIdx)),
        };
        tokens.push(node);
        i = closeIdx + 1;
        plainStart = i;
        continue;
      }
    }

    // ── _italic_ → RichTextItalic (single underscore) ───────────────────────
    if (c === "_" && !(i + 1 < end && text[i + 1] === "_")) {
      const closeIdx = findSingleDelim(text, "_", i + 1, end);
      if (closeIdx !== -1) {
        flushPlain(i);
        const node: RichTextItalic = {
          type: "italic",
          text: parseInline(text.slice(i + 1, closeIdx)),
        };
        tokens.push(node);
        i = closeIdx + 1;
        plainStart = i;
        continue;
      }
    }

    // ── plain text ───────────────────────────────────────────────────────────
    i++;
  }

  flushPlain(end);

  if (tokens.length === 0) return "";
  if (tokens.length === 1) return tokens[0];
  return tokens;
}

/** Parse all inline entities in `text`. */
function parseInline(text: string): RichText {
  if (!text) return "";
  return parseInlineRange(text, 0, text.length);
}

// ─── GFM table detection ──────────────────────────────────────────────────────

/**
 * Returns true if `line` is a GFM table separator row,
 * i.e. each pipe-delimited cell contains only `-`, `:`, and whitespace.
 */
function isTableSeparatorRow(line: string): boolean {
  const stripped = line.trim();
  if (!stripped.includes("|")) return false;
  // Remove optional leading/trailing pipe, then split on |
  const inner = stripped.replace(/^\||\|$/g, "");
  const cells = inner.split("|");
  return (
    cells.length > 0 &&
    cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell))
  );
}

/**
 * Returns true if `lines` represent a GFM table
 * (contains a valid separator row with at least one `|`).
 */
function isGfmTable(lines: string[]): boolean {
  if (lines.length < 2) return false;
  return lines.some((l) => isTableSeparatorRow(l));
}

// ─── Block parser state ───────────────────────────────────────────────────────

interface ParseState {
  blocks: RichBlock[];
  /** Lines accumulating into a paragraph. */
  paragraph: string[] | null;
  /** Lines accumulating into a blockquote (stripped of `> ` prefix). */
  quote: string[] | null;
  /** Current list being built. */
  list: {
    ordered: boolean;
    items: Array<{ text: string; value?: number }>;
  } | null;
  /** Current fenced code block being built. */
  code: { lang: string; lines: string[] } | null;
}

function makeState(): ParseState {
  return {
    blocks: [],
    paragraph: null,
    quote: null,
    list: null,
    code: null,
  };
}

// ─── Flush helpers ────────────────────────────────────────────────────────────

function flushParagraph(state: ParseState): void {
  const lines = state.paragraph;
  state.paragraph = null;
  if (!lines || lines.length === 0) return;

  // GFM table passthrough
  if (lines.some((l) => l.includes("|")) && isGfmTable(lines)) {
    console.debug(
      "[10-3014] GFM table detected but deferred to Phase 3 compiler",
    );
    const block: RichBlockParagraph = {
      type: "paragraph",
      text: lines.join("\n"),
    };
    state.blocks.push(block);
    return;
  }

  const block: RichBlockParagraph = {
    type: "paragraph",
    text: parseInline(lines.join("\n")),
  };
  state.blocks.push(block);
}

function flushList(state: ParseState): void {
  const pending = state.list;
  state.list = null;
  if (!pending || pending.items.length === 0) return;

  const { ordered, items } = pending;
  const listItems: RichBlockListItem[] = items.map((item, idx) => {
    const numValue = item.value ?? idx + 1;
    const label = ordered ? `${numValue}.` : "•";
    const li: RichBlockListItem = {
      label,
      blocks: [
        { type: "paragraph", text: parseInline(item.text) } as RichBlockParagraph,
      ],
    };
    if (ordered) {
      li.value = numValue;
      li.type = "1";
    }
    return li;
  });

  const block: RichBlockList = { type: "list", items: listItems };
  state.blocks.push(block);
}

function flushQuote(state: ParseState): void {
  const lines = state.quote;
  state.quote = null;
  if (!lines || lines.length === 0) return;

  const innerText = lines.join("\n");
  // Recursively parse the inner content
  const innerBlocks = _parseBlocks(innerText, false);
  const block: RichBlockBlockQuotation = {
    type: "blockquote",
    blocks: innerBlocks,
  };
  state.blocks.push(block);
}

function flushCode(state: ParseState): void {
  const pending = state.code;
  state.code = null;
  if (!pending) return;

  const block: RichBlockPreformatted = {
    type: "pre",
    text: pending.lines.join("\n"),
  };
  if (pending.lang) {
    block.language = pending.lang;
  }
  state.blocks.push(block);
}

/** Flush paragraph, list, and blockquote (not code). */
function flushInline(state: ParseState): void {
  flushParagraph(state);
  flushList(state);
  flushQuote(state);
}

// ─── Regexes ──────────────────────────────────────────────────────────────────

const RE_HEADING = /^(#{1,6})\s+(.*)/;
const RE_FENCE_OPEN = /^```(\w*)\s*$/;
const RE_FENCE_CLOSE = /^`{3,}\s*$/;
const RE_UL_ITEM = /^[-*]\s+([\s\S]*)/;
const RE_OL_ITEM = /^(\d+)\.\s+([\s\S]*)/;
const RE_BLOCKQUOTE = /^>\s?(.*)/;

// ─── Core parsing logic ───────────────────────────────────────────────────────

function _parseBlocks(input: string, partial: boolean): RichBlock[] {
  if (!input) return [];

  const state = makeState();
  const lines = input.split("\n");

  for (const line of lines) {
    // ── Inside a fenced code block ─────────────────────────────────────────
    if (state.code !== null) {
      if (RE_FENCE_CLOSE.test(line)) {
        flushCode(state);
      } else {
        state.code.lines.push(line);
      }
      continue;
    }

    // ── Fenced code block opening ──────────────────────────────────────────
    const fenceMatch = RE_FENCE_OPEN.exec(line);
    if (fenceMatch) {
      flushInline(state);
      state.code = { lang: fenceMatch[1] ?? "", lines: [] };
      continue;
    }

    // ── ATX heading ────────────────────────────────────────────────────────
    const headingMatch = RE_HEADING.exec(line);
    if (headingMatch) {
      flushInline(state);
      const size = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const block: RichBlockSectionHeading = {
        type: "heading",
        size,
        text: parseInline(headingMatch[2].trim()),
      };
      state.blocks.push(block);
      continue;
    }

    // ── Blank line ─────────────────────────────────────────────────────────
    if (line.trim() === "") {
      flushInline(state);
      continue;
    }

    // ── Blockquote ─────────────────────────────────────────────────────────
    const bqMatch = RE_BLOCKQUOTE.exec(line);
    if (bqMatch) {
      // Different non-quote context → flush first
      flushParagraph(state);
      flushList(state);
      if (state.quote === null) {
        state.quote = [];
      }
      state.quote.push(bqMatch[1]);
      continue;
    }

    // Non-blockquote line: flush any pending quote
    if (state.quote !== null) {
      flushQuote(state);
    }

    // ── Unordered list item ────────────────────────────────────────────────
    const ulMatch = RE_UL_ITEM.exec(line);
    if (ulMatch) {
      flushParagraph(state);
      // Flush if switching from ordered to unordered
      if (state.list?.ordered) {
        flushList(state);
      }
      if (state.list === null) {
        state.list = { ordered: false, items: [] };
      }
      state.list.items.push({ text: ulMatch[1] });
      continue;
    }

    // ── Ordered list item ──────────────────────────────────────────────────
    const olMatch = RE_OL_ITEM.exec(line);
    if (olMatch) {
      flushParagraph(state);
      // Flush if switching from unordered to ordered
      if (state.list !== null && !state.list.ordered) {
        flushList(state);
      }
      if (state.list === null) {
        state.list = { ordered: true, items: [] };
      }
      state.list.items.push({
        text: olMatch[2],
        value: parseInt(olMatch[1], 10),
      });
      continue;
    }

    // ── Regular paragraph text ─────────────────────────────────────────────
    // Flush any pending list before starting/continuing a paragraph
    if (state.list !== null) {
      flushList(state);
    }
    if (state.paragraph === null) {
      state.paragraph = [];
    }
    state.paragraph.push(line);
  }

  // ── End of input — flush remaining pending blocks ────────────────────────
  if (state.code !== null) {
    // Unclosed fenced code block: emit as preformatted (graceful fallback;
    // this is also the correct behaviour in partial mode per assignment spec).
    flushCode(state);
  }

  flushInline(state);

  return state.blocks;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a Markdown string to an array of `RichBlock` objects.
 *
 * - **Never throws.** Any input that cannot be represented as a known Phase 1
 *   block type is emitted as a `RichBlockParagraph` containing the raw text.
 * - **`partial` mode:** when `true`, unclosed constructs (fenced code blocks,
 *   inline spans) are emitted as-is rather than silently discarded.  The
 *   behaviour for unclosed code blocks is identical to the non-partial path
 *   (they are always emitted), making this function safe to call during
 *   streaming.
 *
 * @param input   The Markdown text to compile.  May be empty or `undefined`.
 * @param partial Pass `true` when `input` may be an incomplete (streaming)
 *                fragment.
 * @returns       An array of `RichBlock` objects (may be empty).
 */
export function markdownToRichBlocks(
  input: string,
  partial = false,
): RichBlock[] {
  try {
    return _parseBlocks(input ?? "", partial);
  } catch {
    // Absolute safety net — should never be reached in practice.
    const raw = (input ?? "").trim();
    return raw ? [{ type: "paragraph", text: raw } as RichBlockParagraph] : [];
  }
}
