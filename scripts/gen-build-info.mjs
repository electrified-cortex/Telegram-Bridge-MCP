#!/usr/bin/env node
// Generates dist/tools/build-info.json with git commit hash and build timestamp.
// Called as part of `pnpm build`. Falls back gracefully if git is unavailable.

import { execSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";

let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
} catch {
  // No git available (e.g., inside Docker without .git context)
}

const buildTime = new Date().toISOString();

mkdirSync("dist/tools", { recursive: true });

writeFileSync(
  "dist/tools/build-info.json",
  JSON.stringify({ BUILD_COMMIT: commit, BUILD_TIME: buildTime }, null, 2) + "\n"
);

console.log(`build-info: commit=${commit} time=${buildTime}`);
