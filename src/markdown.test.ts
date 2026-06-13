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

// ─── Regression baseline — 10-3010 ────────────────────────────────────────────
// All lines below are additions only; no lines above are modified.
import { vi, beforeEach } from "vitest";
import { resolveParseMode } from "./markdown.js";
import { buildHeader } from "./outbound-proxy.js";
import { splitMessage } from "./telegram.js";

// vi.hoisted() ensures mock functions exist before vi.mock() factories run.
// Vitest hoists vi.hoisted() and vi.mock() calls to the top of the module.
const _mocks = vi.hoisted(() => ({
  primarySessionCount: vi.fn(),
  getSession: vi.fn(),
  getCallerSid: vi.fn(),
  resolveNameTag: vi.fn(),
}));

vi.mock("./session-manager.js", () => ({
  primarySessionCount: _mocks.primarySessionCount,
  getSession: _mocks.getSession,
}));

vi.mock("./session-context.js", () => ({
  getCallerSid: _mocks.getCallerSid,
}));

vi.mock("./tools/name-tag.js", () => ({
  resolveNameTag: _mocks.resolveNameTag,
}));

describe("regression baseline — 10-3010", () => {
  // ── markdownToV2 construct snapshots ───────────────────────────────────────
  describe("markdownToV2 — construct snapshots", () => {
    it("bold double-asterisk", () => {
      expect(markdownToV2("**hello world**")).toMatchSnapshot();
    });

    it("bold single-asterisk", () => {
      expect(markdownToV2("*hello world*")).toMatchSnapshot();
    });

    it("italic underscore", () => {
      expect(markdownToV2("_hello world_")).toMatchSnapshot();
    });

    it("underline double-underscore", () => {
      expect(markdownToV2("__hello world__")).toMatchSnapshot();
    });

    it("strikethrough", () => {
      expect(markdownToV2("~~hello world~~")).toMatchSnapshot();
    });

    it("inline code", () => {
      expect(markdownToV2("`hello world`")).toMatchSnapshot();
    });

    it("fenced code block with language tag", () => {
      expect(markdownToV2("```js\nconst x = 1;\n```")).toMatchSnapshot();
    });

    it("fenced code block without language tag", () => {
      expect(markdownToV2("```\nconst x = 1;\n```")).toMatchSnapshot();
    });

    it("blockquote single line", () => {
      expect(markdownToV2("> hello world")).toMatchSnapshot();
    });

    it("ATX heading H1", () => {
      expect(markdownToV2("# Heading One")).toMatchSnapshot();
    });

    it("ATX heading H2", () => {
      expect(markdownToV2("## Heading Two")).toMatchSnapshot();
    });

    it("ATX heading H3", () => {
      expect(markdownToV2("### Heading Three")).toMatchSnapshot();
    });

    it("ATX heading H4", () => {
      expect(markdownToV2("#### Heading Four")).toMatchSnapshot();
    });

    it("ATX heading H5", () => {
      expect(markdownToV2("##### Heading Five")).toMatchSnapshot();
    });

    it("ATX heading H6", () => {
      expect(markdownToV2("###### Heading Six")).toMatchSnapshot();
    });

    it("hyperlink", () => {
      expect(markdownToV2("[click here](https://example.com)")).toMatchSnapshot();
    });

    it("plain text with all V2_SPECIAL chars", () => {
      // V2_SPECIAL covers: _ * [ ] ( ) ~ ` > # + - = | { } . ! \
      expect(markdownToV2("_ * [ ] ( ) ~ ` > # + - = | { } . ! \\")).toMatchSnapshot();
    });

    it("markdown table pipe syntax — current escape-through behavior", () => {
      expect(markdownToV2("| col1 | col2 |\n| --- | --- |\n| a | b |")).toMatchSnapshot();
    });

    it("unordered list dash — current passthrough", () => {
      expect(markdownToV2("- item one\n- item two\n- item three")).toMatchSnapshot();
    });

    it("unordered list asterisk — current passthrough", () => {
      expect(markdownToV2("* item one\n* item two")).toMatchSnapshot();
    });

    it("ordered list — current passthrough", () => {
      expect(markdownToV2("1. item one\n2. item two\n3. item three")).toMatchSnapshot();
    });

    it("mixed content — heading paragraph code block list", () => {
      const input = [
        "# Title",
        "",
        "Some **bold** and _italic_ text.",
        "",
        "```js",
        "const x = 1;",
        "```",
        "",
        "- item one",
        "- item two",
      ].join("\n");
      expect(markdownToV2(input)).toMatchSnapshot();
    });
  });

  // ── markdownToV2 partial mode ──────────────────────────────────────────────
  describe("markdownToV2 — partial mode snapshots", () => {
    it("partial mode unclosed bold", () => {
      expect(markdownToV2("**unclosed bold", true)).toMatchSnapshot();
    });

    it("partial mode unclosed italic", () => {
      expect(markdownToV2("_unclosed italic", true)).toMatchSnapshot();
    });

    it("partial mode unclosed inline code", () => {
      expect(markdownToV2("`unclosed code", true)).toMatchSnapshot();
    });

    it("partial mode unclosed fenced code block", () => {
      expect(markdownToV2("```js\nunclosed block", true)).toMatchSnapshot();
    });
  });

  // ── resolveParseMode ───────────────────────────────────────────────────────
  describe("resolveParseMode — snapshots", () => {
    it("Markdown parse mode — converts to MarkdownV2", () => {
      expect(resolveParseMode("**hello**", "Markdown")).toMatchSnapshot();
    });

    it("MarkdownV2 parse mode — passthrough", () => {
      expect(resolveParseMode("*hello*", "MarkdownV2")).toMatchSnapshot();
    });

    it("HTML parse mode — passthrough", () => {
      expect(resolveParseMode("<b>hello</b>", "HTML")).toMatchSnapshot();
    });

    it("undefined parse mode — passthrough", () => {
      expect(resolveParseMode("hello world")).toMatchSnapshot();
    });
  });

  // ── buildHeader ────────────────────────────────────────────────────────────
  describe("buildHeader — snapshots", () => {
    beforeEach(() => {
      vi.resetAllMocks();
      _mocks.primarySessionCount.mockReturnValue(1);
      _mocks.getCallerSid.mockReturnValue(0);
      _mocks.getSession.mockReturnValue(undefined);
    });

    it("single-session context — returns empty strings", () => {
      // primarySessionCount() < 2 → early return { plain: "", formatted: "" }
      expect(buildHeader()).toMatchSnapshot();
    });

    it("multi-session MarkdownV2 — formats name tag in backticks", () => {
      _mocks.primarySessionCount.mockReturnValue(2);
      _mocks.getCallerSid.mockReturnValue(1);
      _mocks.getSession.mockReturnValue({
        sid: 1, name: "TestBot", color: "🟦",
        connectionToken: "tok", suffix: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastPollAt: undefined, healthy: true,
      });
      _mocks.resolveNameTag.mockReturnValue("TestBot");
      expect(buildHeader()).toMatchSnapshot();
    });

    it("multi-session HTML — formats name tag in code tag", () => {
      _mocks.primarySessionCount.mockReturnValue(2);
      _mocks.getCallerSid.mockReturnValue(1);
      _mocks.getSession.mockReturnValue({
        sid: 1, name: "TestBot", color: "🟦",
        connectionToken: "tok", suffix: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        lastPollAt: undefined, healthy: true,
      });
      _mocks.resolveNameTag.mockReturnValue("TestBot");
      expect(buildHeader("HTML")).toMatchSnapshot();
    });
  });

  // ── splitMessage ───────────────────────────────────────────────────────────
  describe("splitMessage — chunking snapshot", () => {
    it("5000-char input — split points are stable", () => {
      // 4000 'a' chars + '\n\n' + 998 'b' chars = 5000 chars total.
      // splitMessage prefers the last \n\n before index 4096; finds it at 4000
      // → trimEnd removes the trailing \n\n, chunk1 = 4000 chars, chunk2 = 998 chars.
      const text = "a".repeat(4000) + "\n\n" + "b".repeat(998);
      const chunks = splitMessage(text);
      expect(chunks.length).toBe(2);
      expect(chunks.every((c) => c.length <= 4096)).toBe(true);
      expect({ count: chunks.length, lengths: chunks.map((c) => c.length) }).toMatchSnapshot();
    });
  });
});
