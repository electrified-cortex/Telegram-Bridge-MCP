import { describe, it, expect } from "vitest";
import { markdownToV2 } from "./markdown.js";


describe("markdownToV2", () => {
  it("escapes plain text special chars", () => {
    expect(markdownToV2("Hello. World!")).toBe("Hello\\. World\\!");
  });

  it("converts **bold** to *bold*", () => {
    expect(markdownToV2("**hello**")).toBe("*hello*");
  });

  it("converts _italic_", () => {
    expect(markdownToV2("_hi_")).toBe("_hi_");
  });

  it("escapes underscore bounded by word chars — identifier context", () => {
    // Single underscore between alphanumeric chars must be escaped, not treated as italic
    expect(markdownToV2("STT_HOST")).toBe("STT\\_HOST");
    expect(markdownToV2("TTS_HOST and STT_HOST")).toBe("TTS\\_HOST and STT\\_HOST");
    expect(markdownToV2("my_var_name")).toBe("my\\_var\\_name");
  });

  it("still converts real _italic_ when not bounded by word chars", () => {
    expect(markdownToV2("_italic text_")).toBe("_italic text_");
    expect(markdownToV2("use _emphasis_ here")).toBe("use _emphasis_ here");
  });

  it("converts __underline__", () => {
    expect(markdownToV2("__under__")).toBe("__under__");
  });

  it("converts *bold* single asterisk", () => {
    expect(markdownToV2("*hi*")).toBe("*hi*");
  });

  it("preserves inline code escaping backslashes", () => {
    expect(markdownToV2("`foo.bar()`")).toBe("`foo.bar()`");
    expect(markdownToV2("`back\\slash`")).toBe("`back\\\\slash`");
  });

  it("preserves fenced code blocks verbatim", () => {
    const input = "```js\nconsole.log('hi!');\n```";
    expect(markdownToV2(input)).toBe(input);
  });

  it("converts [link](url) — dots in URL are not escaped", () => {
    expect(markdownToV2("[click](https://example.com)"))
      .toBe("[click](https://example.com)");
  });

  it("converts # heading to bold", () => {
    expect(markdownToV2("# Title")).toBe("*Title*");
  });

  it("escapes plain text inside bold content", () => {
    expect(markdownToV2("**foo.bar**")).toBe("*foo\\.bar*");
  });

  it("handles mixed content", () => {
    const out = markdownToV2("Done. **v1.2** saved to `out.json`!");
    expect(out).toBe("Done\\. *v1\\.2* saved to `out.json`\\!");
  });

  it("converts ~~strikethrough~~ to ~strikethrough~", () => {
    expect(markdownToV2("~~deleted~~")).toBe("~deleted~");
  });

  it("escapes plain text inside strikethrough", () => {
    expect(markdownToV2("~~foo.bar~~")).toBe("~foo\\.bar~");
  });

  it("converts > blockquote", () => {
    expect(markdownToV2("> Hello world")).toBe(">Hello world");
  });

  it("escapes special chars inside blockquote", () => {
    expect(markdownToV2("> Hello. World!")).toBe(">Hello\\. World\\!");
  });

  it("handles blockquote alongside regular text", () => {
    const out = markdownToV2("Intro.\n\n> A quoted line.\n\nOutro.");
    expect(out).toBe("Intro\\.\n\n>A quoted line\\.\n\nOutro\\.");
  });

  it("normalizes literal \\n sequences to real newlines", () => {
    // When parameters arrive through XML/MCP, \n is a 2-char sequence, not a real newline
    const input = "Line one.\\nLine two.\\n\\nParagraph two.";
    const out = markdownToV2(input);
    expect(out).toBe("Line one\\.\nLine two\\.\n\nParagraph two\\.");
  });

  it("normalizes backslash-escaped quotes (as sent by agents over MCP)", () => {
    // Agents JSON-encode their output, so "claw" arrives as \"claw\" (literal backslash + quote)
    // The fix must strip the backslash so Telegram sees clean double-quotes.
    const input = 'rename all docs to use \\"claw/claws\\" and \\"the provisioner\\"';
    const out = markdownToV2(input);
    // Should contain plain double-quote, NOT backslash+quote artifacts
    expect(out).toContain('"claw');
    expect(out).not.toContain('\\"claw');
    expect(out).not.toContain('\\\\"claw');
  });

  it("normalizes double-backslash to single backslash", () => {
    // Agents sometimes double-escape backslashes: \\ → \
    const input = "a path like C:\\\\Users\\\\name";
    const out = markdownToV2(input);
    expect(out).toContain("C:\\");
    expect(out).not.toContain("C:\\\\\\\\");
  });

  it("normalizes agent-escaped underscores in bold text", () => {
    // Agents often write **send\_confirmation** — the \_ must become _ before
    // the bold tokeniser applies MarkdownV2 escaping, so Telegram shows
    // "send_confirmation" not "send\_confirmation".
    const input = "**send\\_confirmation** is the tool";
    const out = markdownToV2(input);
    expect(out).toContain("*send\\_confirmation*");
    expect(out).not.toContain("send\\\\_confirmation");
  });

  it("real-world: confirmation text with escaped quotes passes through cleanly", () => {
    // The exact scenario reported: agent sends a confirmation with \"quoted terms\"
    const input = 'Do a terminology pass now (rename all docs/comments to use \\"claw/claws\\" and \\"the provisioner\\" consistently)?';
    const out = markdownToV2(input);
    expect(out).toContain('"claw/claws"');
    expect(out).toContain('"the provisioner"');
    expect(out).not.toMatch(/\\"/);
  });

  it("MarkdownV2-escapes backslashes inside fenced code block body", () => {
    // A single \ in code content must become \\\ for MarkdownV2
    const input = "```\na = x\\y\n```"; // body has: a = x\y
    const out = markdownToV2(input);
    expect(out).toContain("x\\\\y"); // a = x\\y (escaped)
  });

  it("does not MCP-normalize inside fenced code blocks", () => {
    // \\n inside a code block stays as the two literal chars backslash+n, not a real newline
    // After MarkdownV2 escaping, \ → \\\ so \\n → \\\\n
    const input = "```\nprintf(\"hello\\nworld\");\n```"; // body: printf("hello\nworld");
    const out = markdownToV2(input);
    expect(out).not.toMatch(/hello\nworld/); // no real newline introduced
    expect(out).toContain("hello\\\\nworld");  // \ escaped to \\\\
  });
});

describe("markdownToV2 — partial mode", () => {
  it("auto-closes unclosed **bold** span", () => {
    expect(markdownToV2("**incomplete", true)).toBe("*incomplete*");
  });

  it("auto-closes unclosed *bold* single-asterisk span", () => {
    expect(markdownToV2("*halfway", true)).toBe("*halfway*");
  });

  it("auto-closes unclosed _italic_ span", () => {
    expect(markdownToV2("_partial italic", true)).toBe("_partial italic_");
  });

  it("auto-closes unclosed __underline__ span", () => {
    expect(markdownToV2("__under", true)).toBe("__under__");
  });

  it("auto-closes unclosed ~~strikethrough~~ span", () => {
    expect(markdownToV2("~~stri", true)).toBe("~stri~");
  });

  it("auto-closes unclosed `inline code` span", () => {
    expect(markdownToV2("`unclosed", true)).toBe("`unclosed`");
  });

  it("auto-closes unclosed fenced code block", () => {
    const input = "```js\nhello world";
    expect(markdownToV2(input, true)).toBe("```js\nhello world```");
  });

  it("handles complete spans identically to non-partial mode", () => {
    const text = "**bold** and _italic_ text.";
    expect(markdownToV2(text, true)).toBe(markdownToV2(text, false));
  });

  it("escapes special chars inside auto-closed span", () => {
    // The content inside the unclosed **span** should still be escaped
    expect(markdownToV2("**foo.bar", true)).toBe("*foo\\.bar*");
  });

  it("non-partial mode (explicit false) escapes unclosed span markers as plain text", () => {
    // When partial=false, unclosed ** falls through to escaped chars
    expect(markdownToV2("**incomplete", false)).toBe("\\*\\*incomplete");
  });
});
