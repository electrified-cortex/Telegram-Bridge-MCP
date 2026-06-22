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
  RichBlockTable,
  RichBlockTableCell,
  RichBlockPhoto,
  RichBlockCollage,
  RichBlockSlideshow,
  RichBlockAnimation,
  RichBlockCaption,
  TgPhotoSize,
  TgAnimation,
  RichTextBold,
  RichTextItalic,
  RichTextUnderline,
  RichTextStrikethrough,
  RichTextCode,
  RichTextAnchorLink,
  RichTextMathematicalExpression,
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

    // ── $math$ → RichTextMathematicalExpression ──────────────────────────────
    // Note: type is RichTextMathematicalExpression per schema; $...$ matches
    // the Markdown convention per the Telegram Bot API 10.1 specification.
    if (c === "$") {
      // $$ at this position is NOT an inline math delimiter — skip both chars
      if (i + 1 < end && text[i + 1] === "$") {
        i += 2;
        continue;
      }
      // $digit → currency amount (e.g. $100): treat as a plain dollar sign
      if (i + 1 < end && /\d/.test(text[i + 1])) {
        i++;
        continue;
      }
      // Look for a closing single $
      const mathClose = text.indexOf("$", i + 1);
      if (mathClose !== -1 && mathClose < end) {
        const expr = text.slice(i + 1, mathClose);
        if (expr.trim().length > 0) {
          flushPlain(i);
          const node: RichTextMathematicalExpression = {
            type: "mathematical_expression",
            expression: expr,
          };
          tokens.push(node);
          i = mathClose + 1;
          plainStart = i;
          continue;
        }
      }
      // No valid closing $ or whitespace-only content → plain dollar sign
      i++;
      continue;
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

// ─── GFM table parser ─────────────────────────────────────────────────────────

/**
 * Parse pipe-delimited `lines` as a GFM table.
 * Returns a `RichBlockTable` on success, or `null` if the lines don't form a
 * valid GFM table (the second line must be a separator row).
 */
function tryParseGfmTable(lines: string[]): RichBlockTable | null {
  if (lines.length < 2) return null;
  // Separator must be the second line
  if (!isTableSeparatorRow(lines[1])) return null;

  // Extract per-column alignment from the separator row
  const sepInner = lines[1].trim().replace(/^\||\|$/g, "");
  const alignments: Array<"left" | "center" | "right" | undefined> = sepInner
    .split("|")
    .map((cell) => {
      const c = cell.trim();
      if (c.startsWith(":") && c.endsWith(":")) return "center";
      if (c.endsWith(":")) return "right";
      if (c.startsWith(":")) return "left";
      return undefined;
    });

  /** Split a pipe-delimited table row into trimmed cell strings. */
  function parseRowCells(line: string): string[] {
    const inner = line.trim().replace(/^\||\|$/g, "");
    return inner.split("|").map((c) => c.trim());
  }

  const cells: RichBlockTableCell[][] = [];

  // Header row (index 0): cells get is_header: true
  const headerRow: RichBlockTableCell[] = parseRowCells(lines[0]).map(
    (cellText, colIdx) => {
      const cell: RichBlockTableCell = { is_header: true };
      const parsed = parseInline(cellText);
      if (parsed !== "") cell.text = parsed;
      const align = alignments[colIdx];
      if (align !== undefined) cell.align = align;
      return cell;
    },
  );
  cells.push(headerRow);

  // Data rows (index 2+; index 1 is the separator row)
  for (let r = 2; r < lines.length; r++) {
    const row: RichBlockTableCell[] = parseRowCells(lines[r]).map(
      (cellText, colIdx) => {
        const cell: RichBlockTableCell = {};
        const parsed = parseInline(cellText);
        if (parsed !== "") cell.text = parsed;
        const align = alignments[colIdx];
        if (align !== undefined) cell.align = align;
        return cell;
      },
    );
    cells.push(row);
  }

  return { type: "table", cells, is_bordered: true };
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
  /** Lines inside a display math block (between `$$` delimiters). */
  math: { lines: string[] } | null;
  /** Lines inside a `:::details` fenced container. */
  details: { summary: string; lines: string[] } | null;
}

function makeState(): ParseState {
  return {
    blocks: [],
    paragraph: null,
    quote: null,
    list: null,
    code: null,
    math: null,
    details: null,
  };
}

// ─── Flush helpers ────────────────────────────────────────────────────────────

function flushParagraph(state: ParseState): void {
  const lines = state.paragraph;
  state.paragraph = null;
  if (!lines || lines.length === 0) return;

  // GFM table — Phase 3 parser
  if (lines.some((l) => l.includes("|")) && isGfmTable(lines)) {
    const table = tryParseGfmTable(lines);
    if (table) {
      state.blocks.push(table);
      return;
    }
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
        { type: "paragraph", text: parseInline(item.text) },
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
/** Matches a full-line Markdown image-link: `![alt](token)` */
const RE_IMAGE_LINK = /^!\[([^\]]*)\]\(([^)]+)\)$/;

// ─── Phase 4: Media block parser ─────────────────────────────────────────────

/**
 * Parse a single Markdown image-link line into a media RichBlock.
 *
 * Dispatch rules (token = the `(...)` portion of `![alt](token)`):
 *
 * | Token                            | Emitted block        |
 * |----------------------------------|----------------------|
 * | `https://...` or `http://...`    | `null` (pass-through)|
 * | `slideshow:id1 id2 ...`          | `RichBlockSlideshow` |
 * | `animation:id`                   | `RichBlockAnimation` |
 * | `*.gif`                          | `RichBlockAnimation` |
 * | `id1 id2` (2+ space-sep tokens)  | `RichBlockCollage`   |
 * | single non-URL token             | `RichBlockPhoto`     |
 *
 * The `alt` text becomes `caption.text` when non-empty; otherwise `caption` is
 * omitted.  Width, height, duration, and `file_unique_id` are stub values
 * (`0` / `""`) — the actual metadata is resolved during the API send step.
 *
 * @param line A single Markdown line (e.g. `"![My photo](AgACAgI...)"`)
 * @returns The appropriate `RichBlock`, or `null` when the token is a URL.
 */
export function parseMediaBlock(line: string): RichBlock | null {
  const m = RE_IMAGE_LINK.exec(line);
  if (!m) return null;

  const altText = m[1];
  const token = m[2].trim();

  // HTTP / HTTPS URLs → pass through as a regular inline image link
  if (token.startsWith("https://") || token.startsWith("http://")) {
    return null;
  }

  // Build optional caption
  const caption: RichBlockCaption | undefined = altText
    ? { text: altText }
    : undefined;

  // ── slideshow:id1 id2 ... ─────────────────────────────────────────────
  if (token.startsWith("slideshow:")) {
    const fileIds = token.slice("slideshow:".length).trim().split(/\s+/).filter(Boolean);
    const blocks: RichBlock[] = fileIds.map((id): RichBlockPhoto => ({
      type: "photo",
      photo: [{ file_id: id, file_unique_id: "", width: 0, height: 0 }],
    }));
    const result: RichBlockSlideshow = { type: "slideshow", blocks };
    if (caption) result.caption = caption;
    return result;
  }

  // ── animation:id ──────────────────────────────────────────────────────
  if (token.startsWith("animation:")) {
    const fileId = token.slice("animation:".length).trim();
    const animation: TgAnimation = {
      file_id: fileId,
      file_unique_id: "",
      width: 0,
      height: 0,
      duration: 0,
    };
    const result: RichBlockAnimation = { type: "animation", animation };
    if (caption) result.caption = caption;
    return result;
  }

  // ── *.gif ─────────────────────────────────────────────────────────────
  if (token.endsWith(".gif")) {
    const animation: TgAnimation = {
      file_id: token,
      file_unique_id: "",
      width: 0,
      height: 0,
      duration: 0,
    };
    const result: RichBlockAnimation = { type: "animation", animation };
    if (caption) result.caption = caption;
    return result;
  }

  // ── Two or more space-separated file_ids → collage ────────────────────
  const parts = token.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const blocks: RichBlock[] = parts.map((id): RichBlockPhoto => ({
      type: "photo",
      photo: [{ file_id: id, file_unique_id: "", width: 0, height: 0 }],
    }));
    const result: RichBlockCollage = { type: "collage", blocks };
    if (caption) result.caption = caption;
    return result;
  }

  // ── Single non-URL file_id → photo ────────────────────────────────────
  const photoSize: TgPhotoSize = {
    file_id: token,
    file_unique_id: "",
    width: 0,
    height: 0,
  };
  const result: RichBlockPhoto = { type: "photo", photo: [photoSize] };
  if (caption) result.caption = caption;
  return result;
}

// ─── Core parsing logic ───────────────────────────────────────────────────────

function _parseBlocks(input: string, partial: boolean, allowDetails = true): RichBlock[] {
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

    // ── Inside a display math block ($$ ... $$) ────────────────────────────
    if (state.math !== null) {
      if (line.trim() === "$$") {
        const expression = state.math.lines.join("\n").trim();
        state.math = null;
        state.blocks.push({
          type: "mathematical_expression",
          expression,
        });
      } else {
        state.math.lines.push(line);
      }
      continue;
    }

    // ── Inside a :::details fenced container ───────────────────────────────
    if (state.details !== null) {
      if (line === ":::") {
        const { summary, lines: bodyLines } = state.details;
        state.details = null;
        // Recurse with allowDetails=false to prevent nesting (Phase 3 scope)
        const bodyBlocks = _parseBlocks(bodyLines.join("\n"), false, false);
        state.blocks.push({
          type: "details",
          summary: parseInline(summary),
          blocks: bodyBlocks,
        });
      } else {
        state.details.lines.push(line);
      }
      continue;
    }

    // ── Fenced code block opening ──────────────────────────────────────────
    const fenceMatch = RE_FENCE_OPEN.exec(line);
    if (fenceMatch) {
      flushInline(state);
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      state.code = { lang: fenceMatch[1] ?? "", lines: [] };
      continue;
    }

    // ── Display math block opening ($$ on its own line, or $$ expr $$ inline) ─
    {
      const trimmedLine = line.trim();
      if (trimmedLine === "$$") {
        // Multi-line display math: opening $$ delimiter
        flushInline(state);
        state.math = { lines: [] };
        continue;
      }
      if (trimmedLine.startsWith("$$") && trimmedLine.endsWith("$$") && trimmedLine.length > 4) {
        // Single-line display math: $$ expression $$
        const expr = trimmedLine.slice(2, -2).trim();
        if (expr.length > 0) {
          flushInline(state);
          state.blocks.push({
            type: "mathematical_expression",
            expression: expr,
          });
          continue;
        }
      }
    }

    // ── :::details fenced container opening ───────────────────────────────
    if (allowDetails) {
      const detailsMatch = /^:::details(?: (.+))?$/.exec(line);
      if (detailsMatch) {
        flushInline(state);
        state.details = {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          summary: detailsMatch[1] ?? "Details",
          lines: [],
        };
        continue;
      }
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

    // ── Inline image / media block ──────────────────────────────────────────
    {
      const mediaBlock = parseMediaBlock(line);
      if (mediaBlock !== null) {
        flushInline(state);
        state.blocks.push(mediaBlock);
        continue;
      }
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

  if (state.math !== null) {
    // Unclosed $$ math block: fall through to paragraph
    const allLines = ["$$", ...state.math.lines];
    state.math = null;
    state.blocks.push({
      type: "paragraph",
      text: allLines.join("\n"),
    });
  }

  if (state.details !== null) {
    // Unclosed :::details block: fall through to paragraph
    const allLines = [
      `:::details ${state.details.summary}`,
      ...state.details.lines,
    ];
    state.details = null;
    state.blocks.push({
      type: "paragraph",
      text: allLines.join("\n"),
    });
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
    return _parseBlocks(input, partial);
  } catch {
    // Absolute safety net — should never be reached in practice.
    const raw = input.trim();
    return raw ? [{ type: "paragraph", text: raw }] : [];
  }
}
