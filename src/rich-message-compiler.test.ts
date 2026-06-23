/**
 * Tests for markdownToRichBlocks — Phase 1 Markdown → RichBlocks compiler
 * Task: 10-3013
 */
import { describe, it, expect } from "vitest";
import { markdownToRichBlocks, parseMediaBlock } from "./rich-message-compiler.js";
import type {
  RichBlock,
  RichText,
  RichBlockParagraph,
  RichBlockSectionHeading,
  RichBlockPreformatted,
  RichBlockList,
  RichBlockBlockQuotation,
  RichBlockTable,
  RichBlockMathematicalExpression,
  RichBlockDetails,
  RichBlockPhoto,
  RichBlockCollage,
  RichBlockSlideshow,
  RichBlockAnimation,
  RichTextBold,
  RichTextCode,
  RichTextAnchorLink,
  RichTextMathematicalExpression,
} from "./types/rich-message.js";

describe("markdownToRichBlocks", () => {
  // ── 1. Single paragraph ──────────────────────────────────────────────────
  it("1. single paragraph → RichBlockParagraph", () => {
    const result = markdownToRichBlocks("Hello, world!");
    expect(result).toHaveLength(1);
    const block = result[0] as RichBlockParagraph;
    expect(block.type).toBe("paragraph");
    expect(block.text).toBe("Hello, world!");
  });

  // ── 2. Headings ──────────────────────────────────────────────────────────
  it("2a. # Heading → RichBlockSectionHeading size:1", () => {
    const result = markdownToRichBlocks("# Title");
    expect(result).toHaveLength(1);
    const block = result[0] as RichBlockSectionHeading;
    expect(block.type).toBe("heading");
    expect(block.size).toBe(1);
    expect(block.text).toBe("Title");
  });

  it("2b. ## Heading → RichBlockSectionHeading size:2", () => {
    const result = markdownToRichBlocks("## Sub");
    expect(result).toHaveLength(1);
    const block = result[0] as RichBlockSectionHeading;
    expect(block.type).toBe("heading");
    expect(block.size).toBe(2);
  });

  it("2c. ###### Heading → RichBlockSectionHeading size:6", () => {
    const result = markdownToRichBlocks("###### Small");
    expect(result).toHaveLength(1);
    const block = result[0] as RichBlockSectionHeading;
    expect(block.type).toBe("heading");
    expect(block.size).toBe(6);
  });

  it("2d. heading correct level for 3 hashes", () => {
    const result = markdownToRichBlocks("### Three");
    expect(result).toHaveLength(1);
    const block = result[0] as RichBlockSectionHeading;
    expect(block.size).toBe(3);
    expect(block.text).toBe("Three");
  });

  // ── 3. Fenced code block ─────────────────────────────────────────────────
  it("3. fenced code block → RichBlockPreformatted with language", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const result = markdownToRichBlocks(md);
    expect(result).toHaveLength(1);
    const block = result[0] as RichBlockPreformatted;
    expect(block.type).toBe("pre");
    expect(block.language).toBe("typescript");
    expect(block.text).toBe("const x = 1;");
  });

  it("3b. fenced code block without language", () => {
    const md = "```\nplain code\n```";
    const result = markdownToRichBlocks(md);
    expect(result).toHaveLength(1);
    const block = result[0] as RichBlockPreformatted;
    expect(block.type).toBe("pre");
    expect(block.language).toBeUndefined();
    expect(block.text).toBe("plain code");
  });

  // ── 4. Unordered list ────────────────────────────────────────────────────
  it("4. unordered list → RichBlockList with RichBlockListItem children", () => {
    const md = "- Alpha\n- Beta\n- Gamma";
    const result = markdownToRichBlocks(md);
    expect(result).toHaveLength(1);
    const block = result[0] as RichBlockList;
    expect(block.type).toBe("list");
    expect(block.items).toHaveLength(3);
    // Items should NOT have value/type (unordered)
    expect(block.items[0].value).toBeUndefined();
    expect(block.items[0].type).toBeUndefined();
    // Label is the bullet
    expect(block.items[0].label).toBe("•");
    // Each item has blocks
    expect(block.items[0].blocks).toHaveLength(1);
  });

  it("4b. asterisk-style unordered list", () => {
    const md = "* One\n* Two";
    const result = markdownToRichBlocks(md);
    expect(result).toHaveLength(1);
    const block = result[0] as RichBlockList;
    expect(block.type).toBe("list");
    expect(block.items).toHaveLength(2);
  });

  // ── 5. Ordered list ──────────────────────────────────────────────────────
  it("5. ordered list → RichBlockList with ordered RichBlockListItem children", () => {
    const md = "1. First\n2. Second\n3. Third";
    const result = markdownToRichBlocks(md);
    expect(result).toHaveLength(1);
    const block = result[0] as RichBlockList;
    expect(block.type).toBe("list");
    expect(block.items).toHaveLength(3);
    // First item has value and type "1"
    expect(block.items[0].value).toBe(1);
    expect(block.items[0].type).toBe("1");
    expect(block.items[1].value).toBe(2);
    // Label encodes the number
    expect(block.items[0].label).toBe("1.");
    expect(block.items[2].label).toBe("3.");
  });

  // ── 6. Blockquote ────────────────────────────────────────────────────────
  it("6. blockquote → RichBlockBlockQuotation", () => {
    const md = "> This is a quote";
    const result = markdownToRichBlocks(md);
    expect(result).toHaveLength(1);
    const block = result[0] as RichBlockBlockQuotation;
    expect(block.type).toBe("blockquote");
    expect(Array.isArray(block.blocks)).toBe(true);
    expect(block.blocks.length).toBeGreaterThan(0);
  });

  it("6b. multi-line blockquote", () => {
    const md = "> Line one\n> Line two";
    const result = markdownToRichBlocks(md);
    expect(result).toHaveLength(1);
    const block = result[0] as RichBlockBlockQuotation;
    expect(block.type).toBe("blockquote");
  });

  // ── 7. GFM table — Phase 3 parser ────────────────────────────────────────
  describe("7. GFM table", () => {
    it("valid 2-column GFM table → RichBlockTable with header + data rows", () => {
      const md = "| Col A | Col B |\n| --- | --- |\n| val1 | val2 |";
      const result = markdownToRichBlocks(md);
      expect(result).toHaveLength(1);
      const table = result[0] as RichBlockTable;
      expect(table.type).toBe("table");
      expect(table.is_bordered).toBe(true);
      // 2 rows: header + 1 data
      expect(table.cells).toHaveLength(2);
      // Header cells
      expect(table.cells[0][0].is_header).toBe(true);
      expect(table.cells[0][0].text).toBe("Col A");
      expect(table.cells[0][1].text).toBe("Col B");
      // Data cells
      expect(table.cells[1][0].is_header).toBeUndefined();
      expect(table.cells[1][0].text).toBe("val1");
      expect(table.cells[1][1].text).toBe("val2");
    });

    it("alignment hints map to align fields", () => {
      const md =
        "| Left | Center | Right |\n| :--- | :---: | ---: |\n| a | b | c |";
      const result = markdownToRichBlocks(md);
      expect(result).toHaveLength(1);
      const table = result[0] as RichBlockTable;
      expect(table.cells[0][0].align).toBe("left");
      expect(table.cells[0][1].align).toBe("center");
      expect(table.cells[0][2].align).toBe("right");
      // Data row inherits alignment too
      expect(table.cells[1][0].align).toBe("left");
    });

    it("pipes without separator row → plain RichBlockParagraph (not table)", () => {
      const md = "| Col A | Col B |\n| val1 | val2 |";
      const result = markdownToRichBlocks(md);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("paragraph");
    });

    it("empty cells → text omitted", () => {
      const md = "| A | B |\n| --- | --- |\n|  |  |";
      const result = markdownToRichBlocks(md);
      expect(result).toHaveLength(1);
      const table = result[0] as RichBlockTable;
      // empty cells have no text property
      expect(table.cells[1][0].text).toBeUndefined();
      expect(table.cells[1][1].text).toBeUndefined();
    });
  });

  // ── 8. Inline bold ───────────────────────────────────────────────────────
  it("8a. **bold** inside paragraph → RichTextBold node", () => {
    const result = markdownToRichBlocks("Hello **world**!");
    expect(result).toHaveLength(1);
    const para = result[0] as RichBlockParagraph;
    const text = para.text as RichText[];
    expect(Array.isArray(text)).toBe(true);
    const boldNode = text.find(
      (t): t is RichTextBold =>
        typeof t === "object" && !Array.isArray(t) && (t as { type: string }).type === "bold",
    );
    expect(boldNode).toBeDefined();
    expect(boldNode!.type).toBe("bold");
    expect(boldNode!.text).toBe("world");
  });

  it("8b. *bold* (single asterisk) inside paragraph → RichTextBold node", () => {
    const result = markdownToRichBlocks("Say *hello*!");
    expect(result).toHaveLength(1);
    const para = result[0] as RichBlockParagraph;
    const text = para.text as RichText[];
    expect(Array.isArray(text)).toBe(true);
    const boldNode = text.find(
      (t): t is RichTextBold =>
        typeof t === "object" && !Array.isArray(t) && (t as { type: string }).type === "bold",
    );
    expect(boldNode).toBeDefined();
    expect(boldNode!.type).toBe("bold");
  });

  // ── 9. Inline code ───────────────────────────────────────────────────────
  it("9. `code` → RichTextCode node", () => {
    const result = markdownToRichBlocks("Use `console.log()` here");
    expect(result).toHaveLength(1);
    const para = result[0] as RichBlockParagraph;
    const text = para.text as RichText[];
    const codeNode = text.find(
      (t): t is RichTextCode =>
        typeof t === "object" && !Array.isArray(t) && (t as { type: string }).type === "code",
    );
    expect(codeNode).toBeDefined();
    expect(codeNode!.type).toBe("code");
    expect(codeNode!.text).toBe("console.log()");
  });

  // ── 10. Inline link ──────────────────────────────────────────────────────
  it("10. [label](url) → RichTextAnchorLink node", () => {
    const result = markdownToRichBlocks("Visit [Google](https://google.com)");
    expect(result).toHaveLength(1);
    const para = result[0] as RichBlockParagraph;
    const text = para.text as RichText[];
    const linkNode = text.find(
      (t): t is RichTextAnchorLink =>
        typeof t === "object" && !Array.isArray(t) && (t as { type: string }).type === "anchor_link",
    );
    expect(linkNode).toBeDefined();
    expect(linkNode!.type).toBe("anchor_link");
    expect(linkNode!.anchor_name).toBe("https://google.com");
    expect(linkNode!.text).toBe("Google");
  });

  // ── 11. Partial mode — unclosed fenced code block ────────────────────────
  it("11. partial=true with unclosed fenced code → no throw, returns array", () => {
    const md = "```javascript\nconst x = 1;\n// more code...";
    let result: RichBlock[];
    expect(() => {
      result = markdownToRichBlocks(md, true);
    }).not.toThrow();
    expect(Array.isArray(result!)).toBe(true);
    expect(result!.length).toBeGreaterThan(0);
    const pre = result![0] as RichBlockPreformatted;
    expect(pre.type).toBe("pre");
    expect(pre.language).toBe("javascript");
  });

  it("11b. partial=false with unclosed fenced code → also emits preformatted (graceful)", () => {
    const md = "```python\nprint('hello')";
    const result = markdownToRichBlocks(md, false);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    const pre = result[0] as RichBlockPreformatted;
    expect(pre.type).toBe("pre");
  });

  // ── 12. Empty string ─────────────────────────────────────────────────────
  it("12. empty string → [] (no throw)", () => {
    expect(() => {
      const result = markdownToRichBlocks("");
      expect(result).toEqual([]);
    }).not.toThrow();
  });

  it("12b. whitespace-only string → [] (no throw)", () => {
    expect(() => {
      const result = markdownToRichBlocks("   \n\n\t  ");
      expect(result).toEqual([]);
    }).not.toThrow();
  });

  // ── 13. 10 000-char string ───────────────────────────────────────────────
  it("13. 10 000-char string → no throw", () => {
    const big = "a".repeat(5000) + "\n" + "b".repeat(5000);
    expect(() => {
      const result = markdownToRichBlocks(big);
      expect(Array.isArray(result)).toBe(true);
    }).not.toThrow();
  });

  it("13b. 10 000-char all-special-chars → no throw", () => {
    const specials = "**~~__`[]()**~~__`".repeat(600);
    expect(() => {
      const result = markdownToRichBlocks(specials);
      expect(Array.isArray(result)).toBe(true);
    }).not.toThrow();
  });

  // ── 14. Integration gate — no references in src/tools/ ───────────────────
  // (This is validated by the grep acceptance criterion, not a runtime test.
  //  Skipping programmatic check — see assignment item 14.)

  // ── Additional coverage ──────────────────────────────────────────────────
  it("multiple block types in sequence", () => {
    const md = [
      "# Heading",
      "",
      "Paragraph text.",
      "",
      "- item a",
      "- item b",
      "",
      "> blockquote",
    ].join("\n");
    const result = markdownToRichBlocks(md);
    expect(result).toHaveLength(4);
    expect(result[0].type).toBe("heading");
    expect(result[1].type).toBe("paragraph");
    expect(result[2].type).toBe("list");
    expect(result[3].type).toBe("blockquote");
  });

  it("_italic_ → RichTextItalic node", () => {
    const result = markdownToRichBlocks("Say _emphasis_ here");
    expect(result).toHaveLength(1);
    const para = result[0] as RichBlockParagraph;
    const text = para.text as RichText[];
    expect(Array.isArray(text)).toBe(true);
    const italicNode = text.find(
      (t) => typeof t === "object" && !Array.isArray(t) && (t as { type: string }).type === "italic",
    );
    expect(italicNode).toBeDefined();
  });

  it("__underline__ → RichTextUnderline node", () => {
    const result = markdownToRichBlocks("Say __underlined__ here");
    expect(result).toHaveLength(1);
    const para = result[0] as RichBlockParagraph;
    const text = para.text as RichText[];
    expect(Array.isArray(text)).toBe(true);
    const node = text.find(
      (t) => typeof t === "object" && !Array.isArray(t) && (t as { type: string }).type === "underline",
    );
    expect(node).toBeDefined();
  });

  it("~~strikethrough~~ → RichTextStrikethrough node", () => {
    const result = markdownToRichBlocks("Say ~~struck~~ here");
    expect(result).toHaveLength(1);
    const para = result[0] as RichBlockParagraph;
    const text = para.text as RichText[];
    expect(Array.isArray(text)).toBe(true);
    const node = text.find(
      (t) => typeof t === "object" && !Array.isArray(t) && (t as { type: string }).type === "strikethrough",
    );
    expect(node).toBeDefined();
  });

  it("code block multi-line content", () => {
    const md = "```js\nline1\nline2\nline3\n```";
    const result = markdownToRichBlocks(md);
    expect(result).toHaveLength(1);
    const pre = result[0] as RichBlockPreformatted;
    expect(pre.text).toBe("line1\nline2\nline3");
  });

  it("blockquote with inner content is parsed recursively", () => {
    const md = "> # Inner heading";
    const result = markdownToRichBlocks(md);
    expect(result).toHaveLength(1);
    const bq = result[0] as RichBlockBlockQuotation;
    expect(bq.type).toBe("blockquote");
    expect(bq.blocks[0]?.type).toBe("heading");
  });

  // ── Phase 3: LaTeX Math ───────────────────────────────────────────────────

  describe("LaTeX Math", () => {
    it("$$...$$  multi-line block → RichBlockMathematicalExpression", () => {
      const md = "$$\nE = mc^2\n$$";
      const result = markdownToRichBlocks(md);
      expect(result).toHaveLength(1);
      const block = result[0] as RichBlockMathematicalExpression;
      expect(block.type).toBe("mathematical_expression");
      expect(block.expression).toBe("E = mc^2");
    });

    it("single-line $$ expr $$ → RichBlockMathematicalExpression", () => {
      const md = "$$ E = mc^2 $$";
      const result = markdownToRichBlocks(md);
      expect(result).toHaveLength(1);
      const block = result[0] as RichBlockMathematicalExpression;
      expect(block.type).toBe("mathematical_expression");
      expect(block.expression).toBe("E = mc^2");
    });

    it("$...$ inline inside paragraph → RichTextMathematicalExpression", () => {
      const md = "The formula $x^2 + y^2 = r^2$ is classic.";
      const result = markdownToRichBlocks(md);
      expect(result).toHaveLength(1);
      const para = result[0] as { type: string; text: RichText };
      expect(para.type).toBe("paragraph");
      const text = para.text as RichText[];
      expect(Array.isArray(text)).toBe(true);
      const mathNode = text.find(
        (t): t is RichTextMathematicalExpression =>
          typeof t === "object" &&
          !Array.isArray(t) &&
          (t as { type: string }).type === "mathematical_expression",
      );
      expect(mathNode).toBeDefined();
      expect(mathNode!.expression).toBe("x^2 + y^2 = r^2");
    });

    it("$100 (currency) → plain text, not math", () => {
      const md = "Price is $100 today.";
      const result = markdownToRichBlocks(md);
      expect(result).toHaveLength(1);
      const para = result[0] as { type: string; text: RichText };
      expect(para.type).toBe("paragraph");
      // No mathematical_expression node in the result
      const flat = Array.isArray(para.text) ? para.text : [para.text];
      const mathNode = flat.find(
        (t) =>
          typeof t === "object" &&
          !Array.isArray(t) &&
          (t as { type: string }).type === "mathematical_expression",
      );
      expect(mathNode).toBeUndefined();
      // The full text should contain $100 as plain string
      const joined = flat
        .map((t) => (typeof t === "string" ? t : ""))
        .join("");
      expect(joined).toContain("$100");
    });

    it("$$ on a line without closing $$ → paragraph passthrough (no crash)", () => {
      const md = "$$\nunclosed math";
      const result = markdownToRichBlocks(md);
      expect(Array.isArray(result)).toBe(true);
      // Must not throw; emits as paragraph
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("paragraph");
    });
  });

  // ── Phase 3: Collapsible Details ─────────────────────────────────────────

  describe("Collapsible Details", () => {
    it(":::details Title / ::: → RichBlockDetails with correct summary", () => {
      const md = ":::details My Title\nBody content here.\n:::";
      const result = markdownToRichBlocks(md);
      expect(result).toHaveLength(1);
      const block = result[0] as RichBlockDetails;
      expect(block.type).toBe("details");
      expect(block.summary).toBe("My Title");
      expect(Array.isArray(block.blocks)).toBe(true);
      expect(block.blocks.length).toBeGreaterThan(0);
      expect(block.is_open).toBeUndefined();
    });

    it(":::details with no title → summary defaults to 'Details'", () => {
      const md = ":::details\nSome content.\n:::";
      const result = markdownToRichBlocks(md);
      expect(result).toHaveLength(1);
      const block = result[0] as RichBlockDetails;
      expect(block.type).toBe("details");
      expect(block.summary).toBe("Details");
    });

    it("unclosed :::details → paragraph passthrough (no crash)", () => {
      const md = ":::details Title\ncontent without closing";
      const result = markdownToRichBlocks(md);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("paragraph");
    });

    it("body with a heading inside → nested RichBlockSectionHeading in blocks", () => {
      const md = ":::details With Heading\n# Inner\nText.\n:::";
      const result = markdownToRichBlocks(md);
      expect(result).toHaveLength(1);
      const block = result[0] as RichBlockDetails;
      expect(block.type).toBe("details");
      const headingBlock = block.blocks.find((b) => b.type === "heading");
      expect(headingBlock).toBeDefined();
      expect((headingBlock as { type: string; size: number }).size).toBe(1);
    });
  });

  // ── Phase 4: Inline Media Blocks ─────────────────────────────────────────

  describe("Phase 4: Inline Media Blocks — parseMediaBlock()", () => {
    it("P4-1. file_id → RichBlockPhoto with caption.text", () => {
      const result = parseMediaBlock("![My photo](AgACAgI_some_file_id)");
      expect(result).not.toBeNull();
      const block = result as RichBlockPhoto;
      expect(block.type).toBe("photo");
      expect(block.photo).toHaveLength(1);
      expect(block.photo[0].file_id).toBe("AgACAgI_some_file_id");
      expect(block.caption?.text).toBe("My photo");
    });

    it("P4-2. HTTPS URL → null (pass-through)", () => {
      const result = parseMediaBlock("![](https://example.com/img.png)");
      expect(result).toBeNull();
    });

    it("P4-3. HTTP URL → null (pass-through)", () => {
      const result = parseMediaBlock("![](http://example.com/img.jpg)");
      expect(result).toBeNull();
    });

    it("P4-4. two space-separated file_ids → RichBlockCollage with 2 RichBlockPhoto blocks", () => {
      const result = parseMediaBlock("![cats](file_id_1 file_id_2)");
      expect(result).not.toBeNull();
      const block = result as RichBlockCollage;
      expect(block.type).toBe("collage");
      expect(block.blocks).toHaveLength(2);
      expect((block.blocks[0] as RichBlockPhoto).type).toBe("photo");
      expect((block.blocks[0] as RichBlockPhoto).photo[0].file_id).toBe("file_id_1");
      expect((block.blocks[1] as RichBlockPhoto).photo[0].file_id).toBe("file_id_2");
      expect(block.caption?.text).toBe("cats");
    });

    it("P4-5. slideshow:id1 id2 id3 → RichBlockSlideshow with 3 blocks", () => {
      const result = parseMediaBlock("![](slideshow:file_a file_b file_c)");
      expect(result).not.toBeNull();
      const block = result as RichBlockSlideshow;
      expect(block.type).toBe("slideshow");
      expect(block.blocks).toHaveLength(3);
      expect((block.blocks[0] as RichBlockPhoto).photo[0].file_id).toBe("file_a");
      expect((block.blocks[1] as RichBlockPhoto).photo[0].file_id).toBe("file_b");
      expect((block.blocks[2] as RichBlockPhoto).photo[0].file_id).toBe("file_c");
      expect(block.caption).toBeUndefined();
    });

    it("P4-6. animation:file_id → RichBlockAnimation", () => {
      const result = parseMediaBlock("![anim](animation:file_id)");
      expect(result).not.toBeNull();
      const block = result as RichBlockAnimation;
      expect(block.type).toBe("animation");
      expect(block.animation.file_id).toBe("file_id");
      expect(block.animation.duration).toBe(0);
      expect(block.caption?.text).toBe("anim");
    });

    it("P4-7. *.gif → RichBlockAnimation", () => {
      const result = parseMediaBlock("![gif](some_file.gif)");
      expect(result).not.toBeNull();
      const block = result as RichBlockAnimation;
      expect(block.type).toBe("animation");
      expect(block.animation.file_id).toBe("some_file.gif");
      expect(block.caption?.text).toBe("gif");
    });

    it("P4-8. empty alt text on photo → caption omitted", () => {
      const result = parseMediaBlock("![](some_file_id)");
      expect(result).not.toBeNull();
      const block = result as RichBlockPhoto;
      expect(block.type).toBe("photo");
      expect(block.caption).toBeUndefined();
    });

    it("P4-9. non-matching line → null", () => {
      expect(parseMediaBlock("just a plain line")).toBeNull();
      expect(parseMediaBlock("# Heading")).toBeNull();
      expect(parseMediaBlock("[link](url)")).toBeNull();
    });
  });

  describe("Phase 4: Inline Media Blocks — pipeline integration", () => {
    it("P4-10. image on its own line → RichBlockPhoto in markdownToRichBlocks", () => {
      const result = markdownToRichBlocks("![photo](file_id)");
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("photo");
    });

    it("P4-11. image line followed by heading → [RichBlockPhoto, RichBlockSectionHeading]", () => {
      const result = markdownToRichBlocks("![photo](file_id)\n# Heading");
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("photo");
      expect(result[1].type).toBe("heading");
    });

    it("P4-12. HTTPS image in pipeline → paragraph passthrough (not a media block)", () => {
      const result = markdownToRichBlocks("![alt](https://example.com/img.png)");
      expect(result).toHaveLength(1);
      // Falls through to paragraph
      expect(result[0].type).toBe("paragraph");
    });

    it("P4-13. heading then image → [RichBlockSectionHeading, RichBlockPhoto]", () => {
      const result = markdownToRichBlocks("# Title\n![pic](file_xyz)");
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe("heading");
      expect(result[1].type).toBe("photo");
    });
  });
});
