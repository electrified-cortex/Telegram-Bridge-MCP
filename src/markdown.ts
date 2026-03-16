/**
 * Converts standard Markdown to Telegram MarkdownV2 format.
 *
 * Supported conversions:
 *   **bold** / *bold*  →  *bold*
 *   _italic_           →  _italic_
 *   __underline__      →  __underline__
 *   `inline code`      →  `inline code`   (verbatim)
 *   ```lang\ncode\n``` →  ```lang\ncode``` (verbatim)
 *   [text](url)        →  [text](url)
 *   # Heading          →  *Heading*
 *   plain text         →  escaped for MarkdownV2
 *
 * All plain-text characters that carry special meaning in MarkdownV2
 * (_ * [ ] ( ) ~ ` > # + - = | { } . ! \) are automatically escaped.
 *
 * @param partial When true (streaming/draft mode), unclosed Markdown spans are
 *   auto-closed at the end of the text rather than falling back to escaped plain
 *   characters. This makes every intermediate chunk render correctly as formatted
 *   text as the draft grows, without ever producing incomplete escape sequences.
 */

const V2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;
const V2_SPECIAL_CHAR = /[_*[\]()~`>#+\-=|{}.!\\]/;
const MCP_BACKSLASH_STASH = /\\\\/g;
const MCP_MARKDOWN_UNESCAPE = /\\([_*~`[\]()>#+\-=|{}.!])/g;
const FENCED_CODE_BLOCK = /```([^\n`]*)\n([\s\S]*?)```/g;
const FENCED_CODE_UNCLOSED = /```([^\n`]*)\n([\s\S]*)$/;
const BLOCKQUOTE_LINE = /^> ?(.+)$/gm;
const ATX_HEADING = /^#{1,6} +(.+)$/gm;

export function escapeV2(s: string): string {
  return s.replace(V2_SPECIAL, "\\$&");
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Resolves Markdown auto-convert: if parse_mode is "Markdown", converts text
 * to MarkdownV2 and returns the adjusted mode. Otherwise passes through.
 */
export function resolveParseMode(
  text: string,
  parseMode?: string,
): { text: string; parse_mode: "HTML" | "MarkdownV2" | undefined } {
  if (parseMode === "Markdown") {
    return { text: markdownToV2(text), parse_mode: "MarkdownV2" };
  }
  return { text, parse_mode: parseMode as "HTML" | "MarkdownV2" | undefined };
}

export function markdownToV2(input: string, partial = true): string {
  // ── 0. Extract fenced code blocks FIRST so normalization never touches them ─
  const codeBlocks: string[] = [];
  let text = input.replace(FENCED_CODE_BLOCK, (_m: string, lang: string, body: string) => {
    const idx = codeBlocks.length;
    codeBlocks.push("```" + lang + "\n" + body.replace(/[\\`]/g, "\\$&") + "```");
    return `\x00CB${idx}\x00`;
  });
  // In partial mode, also capture unclosed fenced code blocks (no closing ```)
  if (partial) {
    text = text.replace(FENCED_CODE_UNCLOSED, (_m: string, lang: string, body: string) => {
      const idx = codeBlocks.length;
      codeBlocks.push("```" + lang + "\n" + body.replace(/[\\`]/g, "\\$&") + "```");
      return `\x00CB${idx}\x00`;
    });
  }

  // ── 1. Normalize MCP transport escape sequences (outside code blocks only) ─
  //   \n  (two chars) → real newline
  //   \"  (two chars) → real double-quote  (agents JSON-escape quotes before passing)
  //   \\  (two chars) → real backslash     (agents double-escape backslashes)
  //   \X  (where X is a Markdown-special char) → X  (agents escape _ * etc.)
  text = text
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(MCP_BACKSLASH_STASH, "\x00BS\x00")       // stash real backslashes
    .replace(MCP_MARKDOWN_UNESCAPE, "$1")
    .replace(/\x00BS\x00/g, "\\");

  // ── 1b. Extract blockquote lines so > is never re-escaped ───────────────
  const blockquotes: string[] = [];
  text = text.replace(BLOCKQUOTE_LINE, (_m: string, content: string) => {
    const idx = blockquotes.length;
    blockquotes.push(">" + escapeV2(content));
    return `\x00BQ${idx}\x00`;
  });

  // ── 2. Convert ATX headings to bold ─────────────────────────────────────
  text = text.replace(ATX_HEADING, (_m: string, content: string) => `*${escapeV2(content)}*`);

  // ── 3. Inline tokeniser ─────────────────────────────────────────────────
  const out: string[] = [];
  let i = 0;

  while (i < text.length) {

    // Code-block / blockquote placeholder
    if (text[i] === "\x00") {
      const end = text.indexOf("\x00", i + 1);
      const tag = text.slice(i + 1, i + 3);
      const idx = parseInt(text.slice(i + 3, end), 10);
      if (tag === "CB") {
        out.push(codeBlocks[idx]);
      } else {
        out.push(blockquotes[idx]);
      }
      i = end + 1;
      continue;
    }

    // Inline code  `...`
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end !== -1) {
        // Inside code spans, only \ and ` need escaping in MarkdownV2
        const inner = text.slice(i + 1, end).replace(/[\\`]/g, "\\$&");
        out.push("`" + inner + "`");
        i = end + 1;
        continue;
      }
      if (partial) {
        // Auto-close: treat rest of text as code span content
        const inner = text.slice(i + 1).replace(/[\\`]/g, "\\$&");
        out.push("`" + inner + "`");
        i = text.length;
        continue;
      }
    }

    // Strikethrough  ~~text~~
    if (text[i] === "~" && text[i + 1] === "~") {
      const end = text.indexOf("~~", i + 2);
      if (end !== -1) {
        out.push(`~${escapeV2(text.slice(i + 2, end))}~`);
        i = end + 2;
        continue;
      }
      if (partial) {
        out.push(`~${escapeV2(text.slice(i + 2))}~`);
        i = text.length;
        continue;
      }
    }

    // Bold  **text**
    if (text[i] === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        out.push(`*${escapeV2(text.slice(i + 2, end))}*`);
        i = end + 2;
        continue;
      }
      if (partial) {
        out.push(`*${escapeV2(text.slice(i + 2))}*`);
        i = text.length;
        continue;
      }
    }

    // Underline  __text__
    if (text[i] === "_" && text[i + 1] === "_") {
      const end = text.indexOf("__", i + 2);
      if (end !== -1) {
        out.push(`__${escapeV2(text.slice(i + 2, end))}__`);
        i = end + 2;
        continue;
      }
      if (partial) {
        out.push(`__${escapeV2(text.slice(i + 2))}__`);
        i = text.length;
        continue;
      }
    }

    // Bold  *text*  (single asterisk — also treated as bold/emphasis)
    // Not a list marker: list markers are `* ` at the start of a line.
    if (text[i] === "*" && text[i + 1] !== "*" && text[i + 1] !== " " && text[i + 1] !== "\n") {
      const nextNl = text.indexOf("\n", i + 1);
      const limit = nextNl === -1 ? text.length : nextNl;
      const end = text.indexOf("*", i + 1);
      if (end !== -1 && end < limit) {
        out.push(`*${escapeV2(text.slice(i + 1, end))}*`);
        i = end + 1;
        continue;
      }
      if (partial) {
        // Auto-close to end of line (or end of text)
        out.push(`*${escapeV2(text.slice(i + 1, limit))}*`);
        i = limit;
        continue;
      }
    }

    // Italic  _text_  (single underscore)
    // Guard: if preceded by a word char (letter/digit/_), the underscore is part
    // of an identifier (e.g. STT_HOST, my_var) — escape it instead of treating
    // it as an italic marker.  This prevents cross-word pairing like
    // "TTS_HOST … STT_HOST" from accidentally rending as italic text.
    if (text[i] === "_" && text[i + 1] !== "_" && text[i + 1] !== " " && text[i + 1] !== "\n") {
      if (i > 0 && /\w/.test(text[i - 1])) {
        out.push("\\_");
        i++;
        continue;
      }
      const nextNl = text.indexOf("\n", i + 1);
      const limit = nextNl === -1 ? text.length : nextNl;
      const end = text.indexOf("_", i + 1);
      if (end !== -1 && end < limit) {
        out.push(`_${escapeV2(text.slice(i + 1, end))}_`);
        i = end + 1;
        continue;
      }
      if (partial) {
        out.push(`_${escapeV2(text.slice(i + 1, limit))}_`);
        i = limit;
        continue;
      }
    }

    // Link  [text](url)
    if (text[i] === "[") {
      const closeText = text.indexOf("]", i + 1);
      if (closeText !== -1 && text[closeText + 1] === "(") {
        const closeUrl = text.indexOf(")", closeText + 2);
        if (closeUrl !== -1) {
          const linkText = escapeV2(text.slice(i + 1, closeText));
          // In V2 URLs only ) and \ need escaping
          const url = text.slice(closeText + 2, closeUrl).replace(/[)\\]/g, "\\$&");
          out.push(`[${linkText}](${url})`);
          i = closeUrl + 1;
          continue;
        }
        if (partial && closeText !== -1) {
          // Have [text]( but no closing ) — auto-close URL at end of text
          const linkText = escapeV2(text.slice(i + 1, closeText));
          const url = text.slice(closeText + 2).replace(/[)\\]/g, "\\$&");
          out.push(`[${linkText}](${url})`);
          i = text.length;
          continue;
        }
      }
    }

    // Plain character — escape if it is a MarkdownV2 special char
    const ch = text[i];
    out.push(V2_SPECIAL_CHAR.test(ch) ? "\\" + ch : ch);
    i++;
  }

  return out.join("");
}
