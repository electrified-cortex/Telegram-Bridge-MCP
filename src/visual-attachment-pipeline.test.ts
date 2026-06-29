import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock fs/promises and telegram.ts before importing the module under test
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("fs/promises", () => ({
  writeFile: (...args: unknown[]) => mocks.writeFile(...args),
  mkdir: (...args: unknown[]) => mocks.mkdir(...args),
}));

vi.mock("./telegram.js", () => ({
  SAFE_FILE_DIR: "/tmp/telegram-bridge-mcp",
}));

import { join } from "path";
import {
  detectAndExtract,
  responsivizeSvg,
  writeTempVisualFile,
  type VisualBlock,
} from "./visual-attachment-pipeline.js";

// ---------------------------------------------------------------------------
// responsivizeSvg
// ---------------------------------------------------------------------------

describe("responsivizeSvg", () => {
  it("adds viewBox derived from width + height when both are present and no viewBox exists", () => {
    const svg = '<svg width="400" height="300" xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const result = responsivizeSvg(svg);
    expect(result).toContain('viewBox="0 0 400 300"');
  });

  it('sets width="100%" when a fixed pixel width is present', () => {
    const svg = '<svg width="400" height="300"><rect/></svg>';
    const result = responsivizeSvg(svg);
    expect(result).toContain('width="100%"');
    // Original fixed-pixel width should be gone
    expect(result).not.toContain('width="400"');
  });

  it("removes fixed pixel height attribute", () => {
    const svg = '<svg width="400" height="300"><rect/></svg>';
    const result = responsivizeSvg(svg);
    expect(result).not.toMatch(/height="\d+/);
  });

  it("preserves existing viewBox and does not add a second one", () => {
    const svg = '<svg width="400" height="300" viewBox="0 0 800 600"><rect/></svg>';
    const result = responsivizeSvg(svg);
    expect(result).toContain('viewBox="0 0 800 600"');
    const viewBoxCount = (result.match(/viewBox=/g) ?? []).length;
    expect(viewBoxCount).toBe(1);
  });

  it("adds width=100% when SVG has no width attribute", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const result = responsivizeSvg(svg);
    expect(result).toContain('width="100%"');
  });

  it("does not add viewBox when only one dimension is present", () => {
    const svg = '<svg width="400"><rect/></svg>';
    const result = responsivizeSvg(svg);
    expect(result).not.toContain("viewBox=");
    expect(result).toContain('width="100%"');
  });

  it("returns input unchanged when no opening <svg> tag can be matched (malformed/not SVG)", () => {
    const notSvg = "not an svg element at all";
    expect(responsivizeSvg(notSvg)).toBe(notSvg);
  });

  it("preserves non-dimensional attributes (xmlns, id, class, etc.)", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" id="main" class="diagram" width="100" height="50"><rect/></svg>';
    const result = responsivizeSvg(svg);
    expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(result).toContain('id="main"');
    expect(result).toContain('class="diagram"');
  });

  it("handles width/height values with decimal fractions", () => {
    const svg = '<svg width="400.5" height="300.25"><rect/></svg>';
    const result = responsivizeSvg(svg);
    expect(result).toContain('viewBox="0 0 400.5 300.25"');
    expect(result).toContain('width="100%"');
  });

  it("handles multi-line opening tag (attribute on separate lines)", () => {
    const svg = '<svg\n  width="200"\n  height="100"\n><rect/></svg>';
    const result = responsivizeSvg(svg);
    expect(result).toContain('viewBox="0 0 200 100"');
    expect(result).toContain('width="100%"');
    expect(result).not.toMatch(/height="\d+/);
  });
});

// ---------------------------------------------------------------------------
// detectAndExtract — SVG detection
// ---------------------------------------------------------------------------

describe("detectAndExtract — SVG", () => {
  it("detects a single SVG block and replaces with the SVG placeholder", () => {
    const text = 'Here is a diagram:\n<svg width="100" height="50"><rect/></svg>\nEnd.';
    const { modifiedText, blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("svg");
    // Default deliveryMode is "follow-up" → forward-reference wording
    expect(modifiedText).toContain("🖼 [see following attachment·0]");
    expect(modifiedText).not.toContain("<svg");
    expect(modifiedText).toContain("Here is a diagram:");
    expect(modifiedText).toContain("End.");
  });

  it("detects multiple SVG blocks independently, each with its own placeholder", () => {
    const text =
      '<svg width="10" height="10"><a/></svg> text <svg width="20" height="20"><b/></svg>';
    const { modifiedText, blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(2);
    expect(blocks.every(b => b.type === "svg")).toBe(true);
    // Both blocks replaced
    expect(modifiedText).not.toContain("<svg");
    // Each block has a unique filename
    expect(blocks[0].filename).not.toBe(blocks[1].filename);
  });

  it("applies SVG responsivization to detected blocks (content has responsive attrs)", () => {
    const text = '<svg width="400" height="300"><rect/></svg>';
    const { blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toContain('viewBox="0 0 400 300"');
    expect(blocks[0].content).toContain('width="100%"');
    expect(blocks[0].content).not.toMatch(/height="\d+/);
  });

  it("assigns .svg extension to SVG block filenames", () => {
    const text = '<svg><rect/></svg>';
    const { blocks } = detectAndExtract(text);
    expect(blocks[0].filename).toMatch(/\.svg$/);
  });

  it("preserves surrounding prose when extracting SVG", () => {
    const text = "Look at this!\n<svg><rect/></svg>\nPretty cool!";
    const { modifiedText } = detectAndExtract(text);
    expect(modifiedText).toContain("Look at this!");
    expect(modifiedText).toContain("Pretty cool!");
  });

  it("uses follow-up wording (🖼 [see following attachment·N]) as default placeholder", () => {
    const { blocks } = detectAndExtract('<svg><g/></svg>');
    expect(blocks[0].placeholder).toBe("```🖼 [see following attachment·0]```");
  });

  it("uses same-message wording (🖼 [see attachment·N]) when deliveryMode is same-message", () => {
    const { blocks } = detectAndExtract('<svg><g/></svg>', { deliveryMode: "same-message" });
    expect(blocks[0].placeholder).toBe("```🖼 [see attachment·0]```");
  });

  it("each SVG block gets a unique placeholder distinguished by its index", () => {
    const text = '<svg><a/></svg> text <svg><b/></svg>';
    const { modifiedText, blocks } = detectAndExtract(text);
    expect(blocks[0].placeholder).toBe("```🖼 [see following attachment·0]```");
    expect(blocks[1].placeholder).toBe("```🖼 [see following attachment·1]```");
    expect(modifiedText).toContain("🖼 [see following attachment·0]");
    expect(modifiedText).toContain("🖼 [see following attachment·1]");
  });
});

// ---------------------------------------------------------------------------
// detectAndExtract — Mermaid detection
// ---------------------------------------------------------------------------

describe("detectAndExtract — Mermaid", () => {
  it("detects a mermaid fenced block and replaces with the Mermaid placeholder", () => {
    const text = "Before\n```mermaid\ngraph TD\nA-->B\n```\nAfter";
    const { modifiedText, blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("mermaid");
    // Default deliveryMode is "follow-up" → forward-reference wording
    expect(modifiedText).toContain("📊 [see following diagram·0]");
    expect(modifiedText).toContain("Before");
    expect(modifiedText).toContain("After");
    expect(modifiedText).not.toContain("```mermaid");
  });

  it("extracts the diagram source without the fence markers", () => {
    const text = "```mermaid\ngraph TD\nA-->B\n```";
    const { blocks } = detectAndExtract(text);
    expect(blocks[0].content).toContain("graph TD");
    expect(blocks[0].content).toContain("A-->B");
    expect(blocks[0].content).not.toContain("```");
    expect(blocks[0].content).not.toContain("mermaid");
  });

  it("assigns .mmd extension to mermaid block filenames", () => {
    const text = "```mermaid\ngraph TD\nA-->B\n```";
    const { blocks } = detectAndExtract(text);
    expect(blocks[0].filename).toMatch(/\.mmd$/);
  });

  it("uses follow-up wording (📊 [see following diagram·N]) as default placeholder", () => {
    const text = "```mermaid\ngraph TD\nA-->B\n```";
    const { blocks } = detectAndExtract(text);
    expect(blocks[0].placeholder).toBe("```📊 [see following diagram·0]```");
  });

  it("uses same-message wording (📊 [see diagram·N]) when deliveryMode is same-message", () => {
    const text = "```mermaid\ngraph TD\nA-->B\n```";
    const { blocks } = detectAndExtract(text, { deliveryMode: "same-message" });
    expect(blocks[0].placeholder).toBe("```📊 [see diagram·0]```");
  });

  it("each mermaid block gets a unique placeholder distinguished by its index", () => {
    const text =
      "```mermaid\ngraph LR\nA-->B\n```\nSome prose\n```mermaid\nsequenceDiagram\nA->>B: Hi\n```";
    const { modifiedText, blocks } = detectAndExtract(text);
    expect(blocks[0].placeholder).toBe("```📊 [see following diagram·0]```");
    expect(blocks[1].placeholder).toBe("```📊 [see following diagram·1]```");
    expect(modifiedText).toContain("📊 [see following diagram·0]");
    expect(modifiedText).toContain("📊 [see following diagram·1]");
  });

  it("detects multiple mermaid blocks independently", () => {
    const text =
      "```mermaid\ngraph LR\nA-->B\n```\nSome prose\n```mermaid\nsequenceDiagram\nA->>B: Hi\n```";
    const { blocks } = detectAndExtract(text);
    expect(blocks.filter(b => b.type === "mermaid")).toHaveLength(2);
    expect(blocks[0].filename).not.toBe(blocks[1].filename);
  });

  it("preserves surrounding prose when extracting mermaid", () => {
    const text = "Here:\n```mermaid\ngraph TD\nX-->Y\n```\nDone.";
    const { modifiedText } = detectAndExtract(text);
    expect(modifiedText).toContain("Here:");
    expect(modifiedText).toContain("Done.");
  });
});

// ---------------------------------------------------------------------------
// detectAndExtract — false positive guard
// ---------------------------------------------------------------------------

describe("detectAndExtract — non-visual code fences not matched", () => {
  it("does NOT match a ```javascript fenced block", () => {
    const text = '```javascript\nconsole.log("hello")\n```';
    const { blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(0);
  });

  it("does NOT match a ```js fenced block", () => {
    const text = "```js\nconst x = 1;\n```";
    const { blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(0);
  });

  it("does NOT match a ```typescript fenced block", () => {
    const text = "```typescript\nfunction foo() {}\n```";
    const { blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(0);
  });

  it("does NOT match a ```python fenced block", () => {
    const text = "```python\nprint('hi')\n```";
    const { blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(0);
  });

  it("does NOT match a backtick inline code span containing 'mermaid'", () => {
    const text = "Use `mermaid` for diagrams.";
    const { blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(0);
  });

  it("does NOT match ```mermaidjs (word after mermaid)", () => {
    const text = "```mermaidjs\nsome content\n```";
    const { blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(0);
  });

  it("returns text unchanged when there are no visual blocks", () => {
    const text = "Just some normal prose with no diagrams.";
    const { modifiedText, blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(0);
    expect(modifiedText).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// detectAndExtract — graceful malformed SVG
// ---------------------------------------------------------------------------

describe("detectAndExtract — graceful malformed SVG", () => {
  it("does not crash on SVG with no closing tag (malformed)", () => {
    const text = '<svg width="100">no closing tag here';
    expect(() => detectAndExtract(text)).not.toThrow();
    const { blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(0);
  });

  it("wraps a malformed SVG (no closing tag) in a fenced xml code block with a warning note", () => {
    const text = '<svg width="100">no closing tag here';
    const { modifiedText, blocks } = detectAndExtract(text);
    // No visual block — nothing to attach
    expect(blocks).toHaveLength(0);
    // Wrapped in fenced xml code block
    expect(modifiedText).toContain("```xml");
    expect(modifiedText).toContain('<svg width="100">no closing tag here');
    // User-visible warning note
    expect(modifiedText).toContain(
      "⚠️ [SVG could not be processed — shown as source]",
    );
  });

  it("wraps malformed SVG embedded in surrounding prose, preserving the prose", () => {
    const text = 'Before.\n<svg width="100">truncated here';
    const { modifiedText, blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(0);
    expect(modifiedText).toContain("Before.");
    expect(modifiedText).toContain("```xml");
    expect(modifiedText).toContain(
      "⚠️ [SVG could not be processed — shown as source]",
    );
  });

  it("wraps multiple malformed SVG fragments independently (one code block each)", () => {
    const text = '<svg id="a">incomplete <svg id="b">also incomplete';
    const { modifiedText, blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(0);
    const codeBlockCount = (modifiedText.match(/```xml/g) ?? []).length;
    expect(codeBlockCount).toBe(2);
    const noteCount = (
      modifiedText.match(/⚠️ \[SVG could not be processed/g) ?? []
    ).length;
    expect(noteCount).toBe(2);
  });

  it("still extracts and replaces valid SVG even when responsivizeSvg returns raw content (no attrs)", () => {
    // SVG that has valid structure but opening tag is effectively empty
    const text = '<svg></svg>';
    expect(() => detectAndExtract(text)).not.toThrow();
    const { blocks, modifiedText } = detectAndExtract(text);
    // Structural match succeeds
    expect(blocks).toHaveLength(1);
    expect(modifiedText).toContain("🖼 [see following attachment·0]");
  });

  it("empty text returns empty blocks and same text", () => {
    const { modifiedText, blocks } = detectAndExtract("");
    expect(blocks).toHaveLength(0);
    expect(modifiedText).toBe("");
  });

  // ── BLOCK-2 regression: MALFORMED_SVG_CANDIDATE_RE fires on prose after extraction ──
  // When a message contains a complete <svg>…</svg> AND a prose mention of
  // <svg> (no closing tag), the malformed-SVG pass must NOT fire because we
  // already extracted a valid block — the guard prevents mangling prose.

  it("BLOCK-2: complete SVG block + prose <svg> mention → SVG extracted, prose <svg> passes through unmodified", () => {
    const text =
      '<svg width="100" height="50"><rect/></svg>\nThe <svg> element is used for vector graphics.';
    const { blocks, modifiedText } = detectAndExtract(text);
    // Exactly one block extracted (the complete SVG)
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("svg");
    // The SVG block is replaced with its placeholder (follow-up wording by default)
    expect(modifiedText).toContain("🖼 [see following attachment·");
    // The prose <svg> mention is NOT wrapped in a code fence
    expect(modifiedText).toContain("The <svg> element is used for vector graphics.");
    expect(modifiedText).not.toContain("```xml");
    expect(modifiedText).not.toContain("⚠️ [SVG could not be processed");
  });

  it("htmlMode fallback HTML-escapes the malformed content (WARN-2 fix)", () => {
    const text = '<svg width="100">no closing tag <script>evil</script>';
    const { modifiedText } = detectAndExtract(text, { htmlMode: true });
    // Should NOT contain raw < or > inside the <pre><code> block
    // The content should be escaped
    expect(modifiedText).toContain("&lt;svg");
    expect(modifiedText).toContain("&gt;");
    // Warning note still present
    expect(modifiedText).toContain("⚠️ [SVG could not be processed — shown as source]");
    // Wrapped in HTML pre/code, not backtick fence
    expect(modifiedText).toContain("<pre><code>");
    expect(modifiedText).not.toContain("```xml");
  });
});

// ---------------------------------------------------------------------------
// detectAndExtract — mixed SVG + Mermaid
// ---------------------------------------------------------------------------

describe("detectAndExtract — mixed SVG and Mermaid", () => {
  it("handles a message with both SVG and Mermaid blocks", () => {
    const text =
      '<svg><rect/></svg>\nSome prose\n```mermaid\ngraph TD\nA-->B\n```';
    const { blocks, modifiedText } = detectAndExtract(text);
    expect(blocks).toHaveLength(2);
    expect(blocks.some(b => b.type === "svg")).toBe(true);
    expect(blocks.some(b => b.type === "mermaid")).toBe(true);
    // Mermaid is indexed first (index 0), SVG second (index 1) due to indexing order.
    // Default deliveryMode is "follow-up" → forward-reference wording.
    expect(modifiedText).toContain("🖼 [see following attachment·1]");
    expect(modifiedText).toContain("📊 [see following diagram·0]");
    expect(modifiedText).toContain("Some prose");
    // All placeholders are unique across types
    const placeholders = blocks.map(b => b.placeholder);
    expect(new Set(placeholders).size).toBe(2);
  });

  it("mermaid SVG isolation: SVG embedded in a mermaid block is NOT double-detected", () => {
    // Mermaid block contains an SVG — should be extracted as mermaid, not SVG
    const text =
      "```mermaid\ngraph TD\nA-->B\n<!-- <svg>tricky</svg> -->\n```";
    const { blocks } = detectAndExtract(text);
    // Only one block: the mermaid fence; SVG inside is consumed by mermaid pass
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("mermaid");
  });

  it("block filenames and placeholders are unique across types within the same call", () => {
    const text =
      '<svg><rect/></svg>\n```mermaid\ngraph TD\nA-->B\n```\n<svg><circle/></svg>';
    const { blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(3);
    const names = blocks.map(b => b.filename);
    expect(new Set(names).size).toBe(3);
    const placeholders = blocks.map(b => b.placeholder);
    expect(new Set(placeholders).size).toBe(3);
  });

  it("SVG appearing before mermaid in text is returned at index 0 in blocks array", () => {
    // Regression for ordering bug: mermaid pass ran first so blocks were always
    // [mermaid..., svg...] regardless of source position. Blocks must be sorted
    // by their character offset in the original message.
    const text = '<svg><rect/></svg>\nSome prose\n```mermaid\ngraph TD\nA-->B\n```';
    const { blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("svg");
    expect(blocks[1].type).toBe("mermaid");
  });

  it("mermaid appearing before SVG in text is returned at index 0 in blocks array", () => {
    const text = '```mermaid\ngraph TD\nA-->B\n```\nSome prose\n<svg><rect/></svg>';
    const { blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("mermaid");
    expect(blocks[1].type).toBe("svg");
  });

  // ── BLOCK-1 regression: offset coordinate-space apples-to-oranges ─────────
  // With 2+ mermaid blocks, post-mermaid SVG offsets were in a different
  // coordinate space than mermaid offsets captured from the original text,
  // causing the sort to produce wrong document order.

  it("BLOCK-1: 2 mermaid blocks followed by 1 SVG block → blocks[] in document order (mmd-1, mmd-2, svg)", () => {
    const text =
      "```mermaid\ngraph LR\nA-->B\n```\nMiddle prose.\n```mermaid\nsequenceDiagram\nA->>B: Hi\n```\nTrailing prose.\n<svg><circle/></svg>";
    const { blocks, modifiedText } = detectAndExtract(text);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe("mermaid"); // appears first
    expect(blocks[1].type).toBe("mermaid"); // appears second
    expect(blocks[2].type).toBe("svg");     // appears third
    // Prose preserved
    expect(modifiedText).toContain("Middle prose.");
    expect(modifiedText).toContain("Trailing prose.");
    // All placeholders unique
    const placeholders = blocks.map(b => b.placeholder);
    expect(new Set(placeholders).size).toBe(3);
  });

  it("BLOCK-1: SVG block followed by 2 mermaid blocks → blocks[] in document order (svg, mmd-1, mmd-2)", () => {
    const text =
      "<svg><rect/></svg>\nFirst prose.\n```mermaid\ngraph LR\nA-->B\n```\nSecond prose.\n```mermaid\nsequenceDiagram\nA->>B: Hi\n```";
    const { blocks, modifiedText } = detectAndExtract(text);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe("svg");     // appears first
    expect(blocks[1].type).toBe("mermaid"); // appears second
    expect(blocks[2].type).toBe("mermaid"); // appears third
    // Prose preserved
    expect(modifiedText).toContain("First prose.");
    expect(modifiedText).toContain("Second prose.");
    // All placeholders unique
    const placeholders = blocks.map(b => b.placeholder);
    expect(new Set(placeholders).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// D-2: Formatting preservation — slice substitution
// ---------------------------------------------------------------------------
// The substitution must be character-for-character identical to the input
// outside the replaced block's exact span. These tests confirm zero collateral
// changes to surrounding Markdown syntax, punctuation, and whitespace.

describe("detectAndExtract — D-2 formatting preservation (slice substitution)", () => {
  it("D-2: SVG extraction leaves bold/italic/code markup outside the block unchanged", () => {
    const text = "**bold** before\n<svg><rect/></svg>\n*italic* and `code` after";
    const { modifiedText, blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(1);
    const expected = `**bold** before\n${blocks[0].placeholder}\n*italic* and \`code\` after`;
    expect(modifiedText).toBe(expected);
  });

  it("D-2: Mermaid extraction leaves blockquote and newlines outside the block unchanged", () => {
    const text = "> A blockquote\n```mermaid\ngraph TD\nA-->B\n```\n> Another line";
    const { modifiedText, blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(1);
    const expected = `> A blockquote\n${blocks[0].placeholder}\n> Another line`;
    expect(modifiedText).toBe(expected);
  });

  it("D-2: multiple blocks — each substitution is independent, no cross-contamination", () => {
    const text =
      "__bold1__\n<svg><a/></svg>\n~~strike~~\n```mermaid\nsequenceDiagram\nA->>B: Hi\n```\n||spoiler||";
    const { modifiedText, blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(2);
    // Characters outside both blocks must be preserved exactly
    expect(modifiedText).toContain("__bold1__");
    expect(modifiedText).toContain("~~strike~~");
    expect(modifiedText).toContain("||spoiler||");
    // Each block replaced by its placeholder only — no extra whitespace injected
    const svgBlock = blocks.find(b => b.type === "svg")!;
    const mmdBlock = blocks.find(b => b.type === "mermaid")!;
    const expectedLines = [
      "__bold1__",
      svgBlock.placeholder,
      "~~strike~~",
      mmdBlock.placeholder,
      "||spoiler||",
    ];
    expect(modifiedText).toBe(expectedLines.join("\n"));
  });

  it("D-2: no trailing newline added or removed after SVG block", () => {
    const svgBlock = '<svg><rect/></svg>';
    const text = `Before\n${svgBlock}\nAfter`;
    const { modifiedText, blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(1);
    expect(modifiedText).toBe(`Before\n${blocks[0].placeholder}\nAfter`);
  });

  it("D-2: leading/trailing spaces around SVG are preserved (not trimmed)", () => {
    const text = 'Intro  \n<svg><g/></svg>\n  Outro';
    const { modifiedText, blocks } = detectAndExtract(text);
    expect(blocks).toHaveLength(1);
    expect(modifiedText).toBe(`Intro  \n${blocks[0].placeholder}\n  Outro`);
  });
});

// ---------------------------------------------------------------------------
// D-3: Delivery-mode wording
// ---------------------------------------------------------------------------
// The placeholder text must reflect the chosen delivery mode BEFORE it is
// embedded, so what the user reads matches how the message was actually sent.

describe("detectAndExtract — D-3 delivery mode wording", () => {
  it("D-3: same-message SVG placeholder contains 'see attachment' (no 'following')", () => {
    const { blocks } = detectAndExtract('<svg><rect/></svg>', { deliveryMode: "same-message" });
    expect(blocks[0].placeholder).toContain("see attachment");
    expect(blocks[0].placeholder).not.toContain("following");
  });

  it("D-3: follow-up SVG placeholder contains 'see following attachment'", () => {
    const { blocks } = detectAndExtract('<svg><rect/></svg>', { deliveryMode: "follow-up" });
    expect(blocks[0].placeholder).toContain("see following attachment");
  });

  it("D-3: same-message Mermaid placeholder contains 'see diagram' (no 'following')", () => {
    const text = "```mermaid\ngraph TD\nA-->B\n```";
    const { blocks } = detectAndExtract(text, { deliveryMode: "same-message" });
    expect(blocks[0].placeholder).toContain("see diagram");
    expect(blocks[0].placeholder).not.toContain("following");
  });

  it("D-3: follow-up Mermaid placeholder contains 'see following diagram'", () => {
    const text = "```mermaid\ngraph TD\nA-->B\n```";
    const { blocks } = detectAndExtract(text, { deliveryMode: "follow-up" });
    expect(blocks[0].placeholder).toContain("see following diagram");
  });

  it("D-3: omitting deliveryMode defaults to follow-up wording", () => {
    const { blocks: svgBlocks } = detectAndExtract('<svg><rect/></svg>');
    expect(svgBlocks[0].placeholder).toContain("see following");

    const { blocks: mmdBlocks } = detectAndExtract("```mermaid\ngraph TD\nA-->B\n```");
    expect(mmdBlocks[0].placeholder).toContain("see following");
  });

  it("D-3: placeholder wording is embedded into modifiedText (not the raw block content)", () => {
    const text = "Intro\n<svg><rect/></svg>\nOutro";
    const { modifiedText, blocks } = detectAndExtract(text, { deliveryMode: "same-message" });
    expect(modifiedText).toContain(blocks[0].placeholder);
    expect(blocks[0].placeholder).not.toContain("following");
    // modifiedText must not contain the raw SVG
    expect(modifiedText).not.toContain("<svg");
  });
});

// ---------------------------------------------------------------------------
// writeTempVisualFile
// ---------------------------------------------------------------------------

describe("writeTempVisualFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
  });

  it("creates SAFE_FILE_DIR before writing", async () => {
    const block: VisualBlock = {
      type: "svg",
      content: '<svg width="100%"><rect/></svg>',
      placeholder: "🖼 [SVG attached]",
      filename: "diagram-1-0.svg",
    };
    await writeTempVisualFile(block);
    expect(mocks.mkdir).toHaveBeenCalledWith("/tmp/telegram-bridge-mcp", { recursive: true });
  });

  it("writes the block content to a file inside SAFE_FILE_DIR with the correct filename", async () => {
    const block: VisualBlock = {
      type: "svg",
      content: '<svg width="100%"><rect/></svg>',
      placeholder: "🖼 [SVG attached]",
      filename: "diagram-999-0.svg",
    };
    await writeTempVisualFile(block);
    const [filePath, content] = mocks.writeFile.mock.calls[0] as [string, string, unknown];
    expect(filePath).toBe(join("/tmp/telegram-bridge-mcp", "diagram-999-0.svg"));
    expect(content).toBe(block.content);
  });

  it("returns the absolute file path", async () => {
    const block: VisualBlock = {
      type: "mermaid",
      content: "graph TD\nA-->B",
      placeholder: "📊 [diagram attached]",
      filename: "diagram-42-1.mmd",
    };
    const result = await writeTempVisualFile(block);
    expect(result).toBe(join("/tmp/telegram-bridge-mcp", "diagram-42-1.mmd"));
  });

  it("writes mermaid content unchanged (no transformation applied)", async () => {
    const mmdContent = "sequenceDiagram\nAlice->>Bob: Hello\nBob-->>Alice: Hi!";
    const block: VisualBlock = {
      type: "mermaid",
      content: mmdContent,
      placeholder: "📊 [diagram attached]",
      filename: "diagram-1-0.mmd",
    };
    await writeTempVisualFile(block);
    const [, writtenContent] = mocks.writeFile.mock.calls[0] as [string, string, unknown];
    expect(writtenContent).toBe(mmdContent);
  });

  it("writes SVG content as-is (responsivization is done by detectAndExtract)", async () => {
    const svgContent = '<svg width="100%" viewBox="0 0 100 50"><rect/></svg>';
    const block: VisualBlock = {
      type: "svg",
      content: svgContent,
      placeholder: "🖼 [SVG attached]",
      filename: "diagram-1-0.svg",
    };
    await writeTempVisualFile(block);
    const [, writtenContent] = mocks.writeFile.mock.calls[0] as [string, string, unknown];
    expect(writtenContent).toBe(svgContent);
  });
});
