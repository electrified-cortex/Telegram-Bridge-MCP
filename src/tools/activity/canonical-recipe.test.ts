import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { CANONICAL_MONITOR_RECIPE } from "./canonical-recipe.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("canonical-recipe drift guard", () => {
  it("docs/help/activity/file.md contains the exact CANONICAL_MONITOR_RECIPE string", () => {
    const filePath = join(__dirname, "../../../docs/help/activity/file.md");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain(CANONICAL_MONITOR_RECIPE);
  });
});
