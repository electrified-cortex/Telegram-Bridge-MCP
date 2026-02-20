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

  it("converts __underline__", () => {
    expect(markdownToV2("__under__")).toBe("__under__");
  });

  it("converts *bold* single asterisk", () => {
    expect(markdownToV2("*hi*")).toBe("*hi*");
  });

  it("preserves inline code verbatim", () => {
    expect(markdownToV2("`foo.bar()`")).toBe("`foo.bar()`");
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
});
