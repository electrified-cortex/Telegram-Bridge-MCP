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
 */

const V2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;

function escapeV2(s: string): string {
  return s.replace(V2_SPECIAL, "\\$&");
}

export function markdownToV2(input: string): string {
  // ── 1. Extract fenced code blocks so they are never modified ───────────
  const codeBlocks: string[] = [];
  let text = input.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_m, lang, body) => {
    const idx = codeBlocks.length;
    codeBlocks.push("```" + lang + "\n" + body + "```");
    return `\x00CB${idx}\x00`;
  });

  // ── 1b. Extract blockquote lines so > is never re-escaped ───────────────
  const blockquotes: string[] = [];
  text = text.replace(/^> ?(.+)$/gm, (_m, content) => {
    const idx = blockquotes.length;
    blockquotes.push(">" + escapeV2(content));
    return `\x00BQ${idx}\x00`;
  });

  // ── 2. Convert ATX headings to bold ─────────────────────────────────────
  text = text.replace(/^#{1,6} +(.+)$/gm, (_m, content) => `*${escapeV2(content)}*`);

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
    }

    // Strikethrough  ~~text~~
    if (text[i] === "~" && text[i + 1] === "~") {
      const end = text.indexOf("~~", i + 2);
      if (end !== -1) {
        out.push(`~${escapeV2(text.slice(i + 2, end))}~`);
        i = end + 2;
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
    }

    // Underline  __text__
    if (text[i] === "_" && text[i + 1] === "_") {
      const end = text.indexOf("__", i + 2);
      if (end !== -1) {
        out.push(`__${escapeV2(text.slice(i + 2, end))}__`);
        i = end + 2;
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
    }

    // Italic  _text_  (single underscore)
    if (text[i] === "_" && text[i + 1] !== "_" && text[i + 1] !== " " && text[i + 1] !== "\n") {
      const nextNl = text.indexOf("\n", i + 1);
      const limit = nextNl === -1 ? text.length : nextNl;
      const end = text.indexOf("_", i + 1);
      if (end !== -1 && end < limit) {
        out.push(`_${escapeV2(text.slice(i + 1, end))}_`);
        i = end + 1;
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
      }
    }

    // Plain character — escape if it is a MarkdownV2 special char
    const ch = text[i];
    out.push(V2_SPECIAL.test(ch) ? "\\" + ch : ch);
    V2_SPECIAL.lastIndex = 0; // reset stateful regex after .test()
    i++;
  }

  return out.join("");
}
