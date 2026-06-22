# TMCP startup: build-before-start gating

**Captured:** 2026-05-24 (PT)
**Source:** operator voice msg 60942

---

## Verbatim — msg 60942

> Also, I think it's important that for our Telegram MCP, I think we triggered the startup, right? The pnpm start, but I think we should also do, I mean, it scares me a little bit, but shouldn't we do a pnpm on build? Probably not, right? It should have already been built.

---

## Curator notes

**TMCP package.json:**

- `pnpm build` = `tsc && node scripts/gen-build-info.mjs` (compile TS → dist/, write build info)
- `pnpm start` = `node dist/index.js` (runs pre-built dist)

**Current behavior:** start runs pre-built dist; no auto-rebuild. If source changes between sessions and no manual `pnpm build` is run, start launches stale code.

**Risk surface:** TMCP is under active development. Forgetting to rebuild after pulling source changes → silent staleness. Operator's gut concern is real.

## Options

1. **prestart hook** — add `"prestart": "pnpm build"` in package.json. Every start auto-builds. Cost: ~3-5s build time per start. Safest.
2. **Conditional stale check** — startup script compares source mtime vs dist mtime; rebuild if newer. Slightly faster on no-change paths. More complex.
3. **CI guard** — block any PR that touches `src/` without a corresponding `dist/` update. Pushes the build to merge-time, not start-time.
4. **Status quo** — operator manually runs build before start. Today's pattern; risky for autonomous launches.

## Recommendation

Option 1 (prestart hook). Simple, safe, ~3s cost. Stations + dev experience matters more than 3s start latency.

## Open question for operator

Want me to draft the prestart hook PR against Telegram-Bridge-MCP repo? Could land alongside v7.6 release notes work.
