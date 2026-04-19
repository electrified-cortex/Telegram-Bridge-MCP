import { describe, it, expect } from "vitest";
import { checkUnknownParams, injectWarningIntoResult } from "./unknown-param-warning.js";

// ---------------------------------------------------------------------------
// checkUnknownParams
// ---------------------------------------------------------------------------

describe("checkUnknownParams", () => {
  // ── No unknown params ──────────────────────────────────────────────────

  it("returns no warning when all params are known", () => {
    const known = new Set(["token", "timeout"]);
    const args = { token: 123456, timeout: 30 };
    const { clean, warning } = checkUnknownParams("dequeue", known, args);
    expect(warning).toBeUndefined();
    expect(clean).toBe(args); // same reference — no copy needed
  });

  it("returns no warning when args is empty", () => {
    const known = new Set(["token", "timeout"]);
    const { clean, warning } = checkUnknownParams("dequeue", known, {});
    expect(warning).toBeUndefined();
    expect(clean).toEqual({});
  });

  it("returns no warning when knownParams is empty and args is empty", () => {
    const { clean, warning } = checkUnknownParams("help", new Set(), {});
    expect(warning).toBeUndefined();
    expect(clean).toEqual({});
  });

  it("warns 'accepts no parameters' when knownParams is empty and unknown args are present (singular)", () => {
    const { clean, warning } = checkUnknownParams("help", new Set(), { topic: "send" });
    expect(clean).toEqual({});
    expect(warning).toBe("Unknown parameter 'topic' was ignored. help accepts no parameters.");
  });

  it("warns 'accepts no parameters' when knownParams is empty and multiple unknown args are present (plural)", () => {
    const { clean, warning } = checkUnknownParams("help", new Set(), { topic: "send", extra: true });
    expect(clean).toEqual({});
    expect(warning).toMatch(/Unknown parameters .* were ignored\. help accepts no parameters\./);
  });

  // ── Single unknown param ───────────────────────────────────────────────

  it("strips a single unknown param and returns a singular warning", () => {
    const known = new Set(["token", "timeout", "max_wait", "force"]);
    const args = { token: 3165424, force: true };
    const { clean, warning } = checkUnknownParams("dequeue", known, args);
    expect(clean).toEqual({ token: 3165424, force: true }); // both known
    expect(warning).toBeUndefined();
  });

  it("strips an unknown param and returns a singular warning", () => {
    const known = new Set(["token", "timeout", "max_wait", "force"]);
    const args = { token: 3165424, unknown_field: true };
    const { clean, warning } = checkUnknownParams("dequeue", known, args);
    expect(clean).toEqual({ token: 3165424 });
    expect(warning).toMatch(/Unknown parameter 'unknown_field' was ignored/);
    expect(warning).toMatch(/dequeue accepts:/);
    expect(warning).toContain("force");
    expect(warning).toContain("max_wait");
    expect(warning).toContain("timeout");
    expect(warning).toContain("token");
  });

  it("uses singular 'parameter' / 'was' for a single unknown key", () => {
    const known = new Set(["token"]);
    const args = { token: 1, bogus: "x" };
    const { warning } = checkUnknownParams("send", known, args);
    expect(warning).toMatch(/Unknown parameter 'bogus' was ignored/);
  });

  // ── Multiple unknown params ────────────────────────────────────────────

  it("strips multiple unknown params and lists them all in the warning", () => {
    const known = new Set(["token", "timeout"]);
    const args = { token: 3165424, force: true, foo: "bar", baz: 42 };
    const { clean, warning } = checkUnknownParams("dequeue", known, args);
    expect(clean).toEqual({ token: 3165424 });
    expect(warning).toMatch(/Unknown parameters/);
    expect(warning).toMatch(/'force'/);
    expect(warning).toMatch(/'foo'/);
    expect(warning).toMatch(/'baz'/);
    expect(warning).toMatch(/were ignored/);
  });

  it("uses plural 'parameters' / 'were' for multiple unknown keys", () => {
    const known = new Set(["token"]);
    const args = { token: 1, a: 1, b: 2 };
    const { warning } = checkUnknownParams("send", known, args);
    expect(warning).toMatch(/Unknown parameters .* were ignored/);
  });

  // ── accepts list is sorted ─────────────────────────────────────────────

  it("lists accepted params in sorted order", () => {
    const known = new Set(["token", "max_wait", "force", "timeout"]);
    const args = { bad: true };
    const { warning } = checkUnknownParams("dequeue", known, args);
    // Sorted: force, max_wait, timeout, token
    expect(warning).toMatch(/force, max_wait, timeout, token/);
  });

  // ── Unknown param named like a known one but different case ───────────

  it("treats param names as case-sensitive", () => {
    const known = new Set(["token"]);
    const args = { Token: 1 }; // capital T — not known
    const { clean, warning } = checkUnknownParams("dequeue", known, args);
    expect(clean).toEqual({});
    expect(warning).toMatch(/'Token'/);
  });
});

// ---------------------------------------------------------------------------
// injectWarningIntoResult
// ---------------------------------------------------------------------------

describe("injectWarningIntoResult", () => {
  function makeResult(data: Record<string, unknown>) {
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  it("injects warning into a plain toResult payload", () => {
    const result = makeResult({ timed_out: true, pending: 0 });
    const out = injectWarningIntoResult(result, "Unknown parameter 'force' was ignored. dequeue accepts: token.");
    const text = (out as { content: { text: string }[] }).content[0].text;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.timed_out).toBe(true);
    expect(parsed.warning).toContain("Unknown parameter 'force'");
  });

  it("preserves existing warning by prepending new warning", () => {
    const result = makeResult({ ok: true, warning: "existing warning." });
    const out = injectWarningIntoResult(result, "New warning.");
    const text = (out as { content: { text: string }[] }).content[0].text;
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.warning as string).toMatch(/^New warning\. existing warning\.$/);
  });

  it("preserves other content items beyond the first", () => {
    const extra = { type: "text", text: "extra" };
    const result = {
      content: [
        { type: "text", text: JSON.stringify({ ok: true }) },
        extra,
      ],
    };
    const out = injectWarningIntoResult(result, "w");
    const r = out as { content: unknown[] };
    expect(r.content).toHaveLength(2);
    expect(r.content[1]).toBe(extra);
  });

  it("returns result unchanged when content array is empty", () => {
    const result = { content: [] };
    const out = injectWarningIntoResult(result, "w");
    expect(out).toBe(result);
  });

  it("returns result unchanged when first content item is not text type", () => {
    const result = { content: [{ type: "image", data: "abc" }] };
    const out = injectWarningIntoResult(result, "w");
    expect(out).toBe(result);
  });

  it("returns result unchanged when content is not an array", () => {
    const result = { content: null };
    const out = injectWarningIntoResult(result, "w");
    expect(out).toBe(result);
  });

  it("returns result unchanged when JSON parse fails", () => {
    const result = { content: [{ type: "text", text: "not json {{{" }] };
    const out = injectWarningIntoResult(result, "w");
    expect(out).toBe(result);
  });

  it("returns result unchanged when result has no content property", () => {
    const result = { isError: true };
    const out = injectWarningIntoResult(result, "w");
    expect(out).toBe(result);
  });
});
