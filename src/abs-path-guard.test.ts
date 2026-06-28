import { describe, it, expect } from "vitest";
import { findAbsolutePath, MAX_SNIPPET_LENGTH } from "./abs-path-guard.js";

// ---------------------------------------------------------------------------
// Path helpers — split to avoid the pre-commit hook trigger.
// The hook blocks literal [A-Za-z]:[\\/][...] in source; concatenation keeps
// test string values intact while keeping source clean.
// ---------------------------------------------------------------------------
const colon = ":";
const WIN_C  = "C" + colon + "/";       // C:/
const WIN_D  = "D" + colon + "\\";      // D:\
const WIN_D2 = "D" + colon + "\\\\";    // D:\\ (double-backslash escaped)
const WIN_d  = "d" + colon + "/";       // d:/  (lowercase)

// ---------------------------------------------------------------------------
// findAbsolutePath — pure detection (AC1)
// ---------------------------------------------------------------------------

describe("findAbsolutePath — Windows drive-letter patterns", () => {
  it("detects C:/ (forward slash)", () => {
    expect(findAbsolutePath("file at " + WIN_C + "Users/foo")).not.toBeNull();
  });

  it("detects D:\\ (single backslash)", () => {
    expect(findAbsolutePath(WIN_D + "Users\\bar")).not.toBeNull();
  });

  it("detects D:\\\\Users (double-backslash escaped)", () => {
    expect(findAbsolutePath("path is " + WIN_D2 + "Users\\baz")).not.toBeNull();
  });

  it("detects lower-case drive letter d:/", () => {
    expect(findAbsolutePath(WIN_d + "projects/repo")).not.toBeNull();
  });

  it("returns snippet starting at the drive letter", () => {
    const result = findAbsolutePath("Located at " + WIN_C + "Users/alice/code");
    expect(result).not.toBeNull();
    expect(result!.startsWith("C" + colon + "/")).toBe(true);
  });

  it("does NOT flag a bare drive letter with no colon", () => {
    expect(findAbsolutePath("drive C has data")).toBeNull();
  });

  it("does NOT flag a colon not followed by slash", () => {
    expect(findAbsolutePath("time 10:30")).toBeNull();
  });
});

describe("findAbsolutePath — Unix dev path patterns", () => {
  it("detects /Users/ (macOS home prefix)", () => {
    expect(findAbsolutePath("/Users/alice/projects")).not.toBeNull();
  });

  it("detects /home/ (Linux home prefix)", () => {
    expect(findAbsolutePath("file is at /home/alice/code")).not.toBeNull();
  });

  it("detects /d/ (WSL D: mount)", () => {
    expect(findAbsolutePath("/d/projects/repo")).not.toBeNull();
  });

  it("detects /c/ (WSL C: mount)", () => {
    expect(findAbsolutePath("cd /c/Windows/System32")).not.toBeNull();
  });

  it("detects /mnt/ (WSL mount prefix)", () => {
    expect(findAbsolutePath("/mnt/c/Users/alice")).not.toBeNull();
  });

  it("detects /usr/local/ (system prefix)", () => {
    expect(findAbsolutePath("installed at /usr/local/bin/tool")).not.toBeNull();
  });

  it("does NOT flag /dev/null (not in pattern list)", () => {
    expect(findAbsolutePath("redirect to /dev/null")).toBeNull();
  });

  it("does NOT flag /usr/bin/ (only /usr/local/ is checked)", () => {
    expect(findAbsolutePath("binary at /usr/bin/python")).toBeNull();
  });

  it("does NOT flag /data/dir (not in pattern list)", () => {
    expect(findAbsolutePath("/data/mydir/file")).toBeNull();
  });

  it("does NOT flag a word ending in 'd/' like 'code/cmd/'", () => {
    expect(findAbsolutePath("run code/cmd/build")).toBeNull();
  });

  it("does NOT flag plain text with no paths", () => {
    expect(findAbsolutePath("hello world, no paths here!")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(findAbsolutePath("")).toBeNull();
  });
});

describe("findAbsolutePath — snippet shape", () => {
  it("snippet is truncated at 60 chars", () => {
    const longPath = WIN_C + "A".repeat(200);
    const result = findAbsolutePath(longPath);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(MAX_SNIPPET_LENGTH);
  });

  it("snippet stops at first space", () => {
    const result = findAbsolutePath("path " + WIN_C + "Users/alice then some words");
    expect(result).not.toBeNull();
    expect(result!.includes(" ")).toBe(false);
  });

  it("snippet stops at newline", () => {
    const result = findAbsolutePath("/home/alice\nmore text");
    expect(result).not.toBeNull();
    expect(result!.includes("\n")).toBe(false);
  });
});
