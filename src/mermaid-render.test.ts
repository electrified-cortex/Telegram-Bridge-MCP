/**
 * Unit tests for the mermaid-render wrapper module (src/mermaid-render.ts).
 *
 * AC6 note: beautiful-mermaid is a pure-JS, zero-DOM, in-process engine.
 * No Chromium, no container, no external binary is required. Coverage verified
 * by the package import succeeding (i.e. this file compiling and the mock
 * resolving) rather than by an explicit assertion.
 */
import { vi, describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Mock beautiful-mermaid before importing the module under test.
// vi.hoisted ensures the mock variable is initialized before vi.mock hoists.
// ---------------------------------------------------------------------------

const { mockRenderMermaidSVGAsync } = vi.hoisted(() => ({
  mockRenderMermaidSVGAsync: vi.fn<(source: string) => Promise<string | undefined>>(),
}));

vi.mock("beautiful-mermaid", () => ({
  renderMermaidSVGAsync: mockRenderMermaidSVGAsync,
}));

import { renderMermaidToSvg } from "./mermaid-render.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderMermaidToSvg", () => {
  it("returns the SVG string when renderMermaidSVGAsync resolves with valid SVG (>= 200 bytes)", async () => {
    // A realistic minimal SVG — 200+ bytes
    const validSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">${"x".repeat(200)}</svg>`;
    mockRenderMermaidSVGAsync.mockResolvedValue(validSvg);

    const result = await renderMermaidToSvg("graph TD\nA-->B");

    expect(result).toBe(validSvg);
  });

  it("returns null when renderMermaidSVGAsync resolves with output below MIN_SVG_BYTES (< 200)", async () => {
    // beautiful-mermaid returns partial/short SVG for malformed input rather than throwing
    mockRenderMermaidSVGAsync.mockResolvedValue("<svg></svg>");

    const result = await renderMermaidToSvg("bad mermaid source");

    expect(result).toBeNull();
  });

  it("returns null when renderMermaidSVGAsync resolves with undefined", async () => {
    mockRenderMermaidSVGAsync.mockResolvedValue(undefined);

    const result = await renderMermaidToSvg("graph TD\nA-->B");

    expect(result).toBeNull();
  });

  it("returns null when renderMermaidSVGAsync resolves with empty string", async () => {
    mockRenderMermaidSVGAsync.mockResolvedValue("");

    const result = await renderMermaidToSvg("graph TD\nA-->B");

    expect(result).toBeNull();
  });

  it("returns null (does not throw) when renderMermaidSVGAsync rejects — AC4 guard", async () => {
    mockRenderMermaidSVGAsync.mockRejectedValue(new Error("unsupported diagram type"));

    const result = await renderMermaidToSvg("unsupported: true");

    expect(result).toBeNull();
  });

  it("forwards the source string to renderMermaidSVGAsync", async () => {
    const source = "flowchart LR\nA-->B";
    const validSvg = `<svg xmlns="http://www.w3.org/2000/svg">${"x".repeat(210)}</svg>`;
    mockRenderMermaidSVGAsync.mockResolvedValue(validSvg);

    await renderMermaidToSvg(source);

    expect(mockRenderMermaidSVGAsync).toHaveBeenCalledWith(source);
  });
});
