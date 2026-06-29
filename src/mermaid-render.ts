// src/mermaid-render.ts
// Wraps beautiful-mermaid with a size-check guard and error isolation.
// Returns null on render failure, empty/partial output, or unsupported diagram type.
//
// Known limits (from task 10-3052 spike):
//   - From-scratch parser — exotic mermaid syntax may fail silently
//   - 6 supported diagram types: flowchart, state, sequence, class, ER, XY
//   - @import url(fonts.googleapis.com/...) in <style> — falls back to system-ui offline
//   - Malformed input returns partial SVG (< 200 bytes) rather than throwing

import { renderMermaidSVGAsync } from "beautiful-mermaid";

/** Minimum byte size for a valid SVG output (guards partial-output path). */
const MIN_SVG_BYTES = 200;

/**
 * Renders a Mermaid diagram source string to an SVG string.
 * Returns `null` if the render fails or produces suspiciously small output
 * (beautiful-mermaid returns partial SVG rather than throwing on bad input).
 */
export async function renderMermaidToSvg(source: string): Promise<string | null> {
  try {
    const svg = await renderMermaidSVGAsync(source);
    if (!svg || svg.length < MIN_SVG_BYTES) return null;
    return svg;
  } catch {
    return null;
  }
}
