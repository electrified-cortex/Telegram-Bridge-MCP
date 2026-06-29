/**
 * Visual Attachment Pipeline
 *
 * Detects SVG and Mermaid fenced blocks in outbound text messages, extracts
 * them as separate Telegram document attachments, and replaces each block with
 * a short inline placeholder.
 *
 * Designed to be injected into the outbound text-send path in `tools/send.ts`
 * before the message is rendered and dispatched to Telegram.
 */

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { SAFE_FILE_DIR } from "./telegram.js";
import { renderMermaidToSvg } from "./mermaid-render.js";

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

/**
 * Matches a complete SVG block: opening `<svg …>` through `</svg>`.
 * Non-greedy so each block is captured independently.
 * Case-insensitive because SVG is always lowercase in practice but we match
 * defensively. `\s` matches newlines, enabling multi-line opening tags.
 *
 * Note: `[^>]*` does not handle `>` inside attribute values. For practical
 * AI-generated SVGs this is never an issue; truly malformed SVGs that contain
 * a bare `>` in the opening tag won't match, which is the graceful path.
 */
const SVG_RE = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;

/**
 * Matches SVG-like content that was NOT consumed by SVG_RE (i.e. missing a
 * closing `</svg>`). Used in the graceful malformed-SVG path to wrap stranded
 * `<svg …` fragments in a fenced code block rather than leaving bare markup in
 * the prose.
 *
 * Non-greedy so each stranded fragment is captured up to the next `<svg` or
 * end of string. Reset `lastIndex` before each use (module-level `g` flag).
 */
const MALFORMED_SVG_CANDIDATE_RE = /<svg\b[\s\S]*?(?=<svg\b|$)/gi;

/**
 * Matches a fenced Mermaid block: ` ```mermaid ` through closing ` ``` `.
 * - `[ \t]*` allows optional trailing spaces after `mermaid` on the opening
 *   line without creating false positives on ` ```mermaidjs ` etc.
 * - `[\s\S]*?` is non-greedy so each block is captured independently.
 * - Capturing group 1 holds the raw diagram source (including its trailing
 *   newline before the closing fence).
 *
 * Only `g` flag (not `gm`) — no `^` anchors — to allow blocks indented
 * inside quote/list contexts. False positives on non-visual fences are
 * avoided by the literal `mermaid` word after the backticks.
 */
const MERMAID_RE = /```mermaid[ \t]*\n([\s\S]*?)```/g;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisualBlock {
  type: "svg" | "mermaid";
  /** Content to write to disk (SVG is already responsivized). */
  content: string;
  /** Text substituted into the outbound message in place of the block. */
  placeholder: string;
  /** Filename under SAFE_FILE_DIR. */
  filename: string;
}

export interface ExtractResult {
  /** Message text with all visual blocks replaced by placeholders. */
  modifiedText: string;
  /** Detected blocks in order of first appearance in the source text. */
  blocks: VisualBlock[];
}

/**
 * Delivery mode for visual attachments.
 *
 * - `"same-message"`: prose and attachment are in the **same** Telegram message
 *   (prose sent as the document caption). Placeholder wording reflects this:
 *   "see attachment" / "see diagram".
 * - `"follow-up"` (default): prose sent first as a text message, attachment
 *   sent immediately after as a separate document. Placeholder wording is a
 *   forward reference: "see following attachment" / "see following diagram".
 */
export type DeliveryMode = "same-message" | "follow-up";

export interface DetectExtractOptions {
  /**
   * When true, the malformed-SVG fallback wraps content in HTML
   * `<pre><code>…</code></pre>` instead of backtick fences, so it renders
   * correctly when the message is sent with `parse_mode: "HTML"`.
   */
  htmlMode?: boolean;
  /**
   * Controls placeholder wording embedded into the outbound text.
   *
   * - `"same-message"` → "see attachment" / "see diagram" (same-message reference)
   * - `"follow-up"` (default) → "see following attachment" / "see following diagram" (forward reference)
   *
   * Must be determined **before** calling `detectAndExtract` so that the correct
   * wording is embedded once and the delivery actually matches the chosen mode.
   */
  deliveryMode?: DeliveryMode;
}

// ---------------------------------------------------------------------------
// SVG responsivization
// ---------------------------------------------------------------------------

/**
 * Makes an SVG fill its container responsively:
 * - Derives `viewBox` from existing `width`/`height` if not already present
 * - Replaces the fixed `width` with `width="100%"` (or adds it)
 * - Removes fixed `height` (clients scale height automatically via viewBox)
 * - Collapses any resulting whitespace artefacts in the attribute string
 *
 * Returns the input unchanged if the opening `<svg>` tag cannot be parsed.
 */
export function responsivizeSvg(svgContent: string): string {
  return svgContent.replace(/<svg\b([^>]*)>/i, (_match, rawAttrs: string) => {
    // Extract existing dimensional attributes
    const wMatch = /\bwidth\s*=\s*["']?([\d.]+)(?:px)?["']?/i.exec(rawAttrs);
    const hMatch = /\bheight\s*=\s*["']?([\d.]+)(?:px)?["']?/i.exec(rawAttrs);
    const hasViewBox = /\bviewBox\s*=/i.test(rawAttrs);

    let attrs = rawAttrs;

    // Derive viewBox from explicit dimensions when not already present
    if (!hasViewBox && wMatch && hMatch) {
      attrs += ` viewBox="0 0 ${wMatch[1]} ${hMatch[1]}"`;
    }

    // Set width to 100% (responsive)
    if (wMatch) {
      attrs = attrs.replace(
        /\bwidth\s*=\s*["']?[\d.]+(?:px)?["']?/i,
        'width="100%"',
      );
    } else {
      attrs += ' width="100%"';
    }

    // Remove fixed height
    if (hMatch) {
      attrs = attrs.replace(
        /\s*\bheight\s*=\s*["']?[\d.]+(?:px)?["']?/i,
        "",
      );
    }

    // Normalize any whitespace artefacts left by the replacements
    attrs = attrs.replace(/\s+/g, " ").trim();

    return `<svg ${attrs}>`;
  });
}

// ---------------------------------------------------------------------------
// Detection and extraction
// ---------------------------------------------------------------------------

/**
 * Scans `text` for SVG and Mermaid blocks, extracts them, and returns:
 * - `modifiedText`: the original text with every visual block replaced by
 *   its placeholder string
 * - `blocks`: one entry per detected block, sorted by order of first appearance
 *   in the source text
 *
 * All block start-offsets are captured from the ORIGINAL text before any
 * substitution so that sorting by offset always produces correct document
 * order, even when 2+ mermaid blocks precede an SVG block (BLOCK-1 fix).
 *
 * SVG matches that overlap with a mermaid fence are filtered out so that SVG
 * content embedded inside a ```mermaid…``` block is not double-counted.
 *
 * Graceful for malformed input:
 * - SVG with no closing tag (`<svg …` without `</svg>`) → regex never
 *   matches → block left in text verbatim, no crash
 * - If `responsivizeSvg` throws → raw SVG content used as fallback
 * - The malformed-SVG fallback only runs when NO complete SVG blocks were
 *   detected, preventing prose `<svg>` mentions from being mangled after a
 *   successful extraction (BLOCK-2 fix)
 */
export function detectAndExtract(text: string, opts?: DetectExtractOptions): ExtractResult {
  let index = 0;
  const ts = Date.now();
  const deliveryMode: DeliveryMode = opts?.deliveryMode ?? "follow-up";

  // ── Step 1: Collect all mermaid matches from the ORIGINAL text ────────────
  // matchAll gives us offsets in the original coordinate space.
  MERMAID_RE.lastIndex = 0;
  const mermaidMatches: Array<{ match: string; content: string; offset: number }> = [];
  for (const m of text.matchAll(MERMAID_RE)) {
    mermaidMatches.push({ match: m[0], content: m[1], offset: m.index });
  }

  // ── Step 2: Collect SVG matches from the ORIGINAL text ───────────────────
  SVG_RE.lastIndex = 0;
  const svgMatchesRaw: Array<{ match: string; offset: number }> = [];
  for (const m of text.matchAll(SVG_RE)) {
    svgMatchesRaw.push({ match: m[0], offset: m.index });
  }

  // ── Step 3: Exclude SVG matches inside a mermaid fence ───────────────────
  // An SVG that overlaps with a mermaid range is consumed by the mermaid pass
  // and must not be separately extracted.
  const svgMatches = svgMatchesRaw.filter(svgM =>
    !mermaidMatches.some(mM =>
      svgM.offset < mM.offset + mM.match.length &&
      svgM.offset + svgM.match.length > mM.offset,
    )
  );

  // ── Step 4: Build blockEntries ────────────────────────────────────────────
  // Mermaid is indexed before SVG to match historical behaviour (callers that
  // assert placeholder indices expect mermaid to receive the lower numbers
  // when mixed blocks are present).
  const blockEntries: Array<{ block: VisualBlock; offset: number; matchLength: number }> = [];

  for (const { match, content, offset } of mermaidMatches) {
    const blockIndex = index++;
    const filename = `diagram-${ts}-${blockIndex}.mmd`;
    // Unique placeholder per block so orphan-restore in the send layer can
    // reliably target exactly one occurrence even when multiple same-type
    // blocks coexist and some succeed while others fail.
    // Wording reflects delivery mode: same-message = current reference,
    // follow-up = forward reference to the next message.
    const placeholder =
      deliveryMode === "same-message"
        ? `📊 [see diagram·${blockIndex}]`
        : `📊 [see following diagram·${blockIndex}]`;
    blockEntries.push({
      block: {
        type: "mermaid",
        content: content.trimEnd(), // strip trailing blank line before closing fence
        placeholder,
        filename,
      },
      offset,
      matchLength: match.length,
    });
  }

  for (const { match, offset } of svgMatches) {
    const blockIndex = index++;
    const filename = `diagram-${ts}-${blockIndex}.svg`;
    // Unique placeholder per block (same rationale as mermaid above).
    // Wording reflects delivery mode: same-message = current reference,
    // follow-up = forward reference to the next message.
    const placeholder =
      deliveryMode === "same-message"
        ? `🖼 [see attachment·${blockIndex}]`
        : `🖼 [see following attachment·${blockIndex}]`;
    let content: string;
    try {
      content = responsivizeSvg(match);
    } catch {
      // Graceful fallback: attach the raw SVG unchanged
      content = match;
    }
    blockEntries.push({
      block: { type: "svg", content, placeholder, filename },
      offset,
      matchLength: match.length,
    });
  }

  // ── Step 5: Sort by original-text offset → correct document order ─────────
  blockEntries.sort((a, b) => a.offset - b.offset);
  const blocks = blockEntries.map(e => e.block);

  // ── Step 6: Apply substitutions in reverse offset order ───────────────────
  // Working end-to-start keeps all earlier offsets valid throughout; all
  // offsets are in original-text coordinate space so no adjustment is needed.
  let modifiedText = text;
  for (let i = blockEntries.length - 1; i >= 0; i--) {
    const { block, offset, matchLength } = blockEntries[i];
    modifiedText =
      modifiedText.slice(0, offset) +
      block.placeholder +
      modifiedText.slice(offset + matchLength);
  }

  // ── Step 7: Malformed SVG fallback ────────────────────────────────────────
  // Any <svg remaining after the SVG pass was not consumed by SVG_RE, meaning
  // it lacks a closing </svg> or is otherwise structurally invalid. Wrap it in
  // a code block and append a user-visible warning note so the message is still
  // sendable and the raw source is visible to the recipient.
  //
  // Guard: only run when NO complete SVG blocks were found. If we already
  // extracted complete blocks, prose mentions of <svg> (e.g. "the <svg>
  // element…") must not be mangled by this pass (BLOCK-2 fix).
  if (svgMatches.length === 0) {
    MALFORMED_SVG_CANDIDATE_RE.lastIndex = 0;
    const htmlMode = opts?.htmlMode ?? false;
    modifiedText = modifiedText.replace(
      MALFORMED_SVG_CANDIDATE_RE,
      (match: string) => {
        if (htmlMode) {
          // HTML-escape so bare `<`/`>` in the malformed fragment do not
          // trigger a Telegram Bad Request in HTML parse_mode (WARN-2 fix).
          const escaped = match.trimEnd()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          return `<pre><code>${escaped}</code></pre>\n⚠️ [SVG could not be processed — shown as source]`;
        }
        return `\`\`\`xml\n${match.trimEnd()}\n\`\`\`\n⚠️ [SVG could not be processed — shown as source]`;
      },
    );
  }

  return { modifiedText, blocks };
}

// ---------------------------------------------------------------------------
// Temporary file I/O
// ---------------------------------------------------------------------------

/**
 * Writes `block.content` to a file under `SAFE_FILE_DIR` and returns the
 * absolute path. Creates the directory if it does not yet exist.
 *
 * The returned path can be passed directly to `resolveMediaSource` from
 * `telegram.ts` — the SAFE_FILE_DIR prefix satisfies the path guard.
 */
export async function writeTempVisualFile(block: VisualBlock): Promise<string> {
  await mkdir(SAFE_FILE_DIR, { recursive: true });
  const filePath = join(SAFE_FILE_DIR, block.filename);
  await writeFile(filePath, block.content, { encoding: "utf-8" });
  return filePath;
}

// ---------------------------------------------------------------------------
// Mermaid companion render
// ---------------------------------------------------------------------------

/**
 * Attempts to render a mermaid VisualBlock to a companion SVG.
 * Returns a new VisualBlock for the companion `.svg` file, or null on failure.
 * The caller is responsible for writing the companion file to disk.
 *
 * The `ts` and `companionIndex` parameters are accepted for call-site
 * consistency; the SVG filename is derived from `block.filename` by replacing
 * the `.mmd` extension with `.svg`.
 */
export async function renderMermaidCompanion(
  block: VisualBlock,
  _ts: number,
  _companionIndex: number,
): Promise<(VisualBlock & { companionCaption: string }) | null> {
  try {
    const svg = await renderMermaidToSvg(block.content);
    if (svg === null) return null;

    const responsiveSvg = responsivizeSvg(svg);
    const filename = block.filename.replace(/\.mmd$/, ".svg");

    return {
      type: "svg",
      content: responsiveSvg,
      filename,
      placeholder: block.placeholder,
      companionCaption: `📊 rendered from ${block.filename}`,
    };
  } catch {
    // Graceful: any unexpected error (e.g. responsivizeSvg edge case) → null,
    // caller ships .mmd alone (AC4).
    return null;
  }
}
