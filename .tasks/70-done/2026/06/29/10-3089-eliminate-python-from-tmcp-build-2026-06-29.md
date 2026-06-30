# 10-3089 — Eliminate ALL python dependency from TMCP build

**Priority:** 10 (high — operator hard directive)
**Repo:** electrified-cortex/Telegram-Bridge-MCP
**Filed:** 2026-06-29
**Source:** Operator directive 2026-06-29 — "TMCP should have ZERO python dependency"

## Problem

The TMCP Dockerfile installs `python3 make g++` in two build stages to compile native
modules from source via node-gyp. PYTHON IS BANNED in TMCP. The same toolchain is also
why the Docker "Publish Docker image" workflow fails with `git: not found` (node-gyp /
native build invokes git during `pnpm install`).

## Root cause (audited 2026-06-29)

- **opusscript@0.1.1**: PURE JS (gypfile:false, no binding.gyp, no install scripts). Does
  NOT need python. The Dockerfile comment listing it as a native module is WRONG/stale.
- **`@huggingface/transformers`** (transformers.js): pulls **onnxruntime-node** (native ONNX
  runtime) + **sharp** (native image). These compile from source via node-gyp → require
  python3 + make + g++ + git.
- `@huggingface/transformers` powers `src/transcribe.ts` (voice→text) and `src/tts.ts`
  (text→speech). These are core VOICE features — cannot simply delete the dependency.

## Fix direction (to validate)

Eliminate source-compilation so no build toolchain (python/make/g++/git) is needed:

1. **Preferred — prebuilt binaries**: onnxruntime-node and sharp BOTH ship prebuilt binaries
   for linux x64 (glibc). Configure the install so pnpm fetches prebuilds instead of compiling
   (e.g. ensure the platform/libc matches node:26-slim = debian bookworm/glibc; avoid
   `--build-from-source`; verify pnpm isn't forcing a rebuild). Then DELETE `python3 make g++`
   (and the never-needed git) from BOTH Dockerfile stages.
2. **Alternative — WASM backend**: transformers.js can run on `onnxruntime-web` (WASM) instead
   of native `onnxruntime-node`. Switching the backend removes the native ONNX dep entirely.
   Trade-off: WASM inference is slower; validate transcription/TTS latency is acceptable.
3. Re-evaluate whether `sharp` is actually used (image resize) or can be dropped/replaced with
   a pure-JS path.

## Acceptance Criteria

- AC-1: TMCP Dockerfile contains NO `python3` (or any python) in any stage.
- AC-2: `docker build` succeeds with no build toolchain installing python/make/g++/git.
- AC-3: The "Publish Docker image" GitHub workflow passes (no `git: not found`).
- AC-4: Voice transcribe (`src/transcribe.ts`) and TTS (`src/tts.ts`) still function in the
  built image (smoke test).
- AC-5: Fix the stale Dockerfile comment (opusscript is pure-JS, not a native module).

## Notes

- Do NOT just add `git` to the Dockerfile (rejected by operator — papers over the symptom,
  keeps python). The objective is ZERO python.
- Native-module build testing requires building the Docker image — cannot be fully verified
  by static analysis alone.
- beautiful-mermaid was audited 2026-06-29 and is CLEAN (no install hooks, no runtime red
  flags) — NOT related to the python/git issue. Keep it.

## Seal — APPROVED (Overseer, 2026-06-29)

- PR: #262 (squash 9211c229), v7.23.1, merged to master by operator.
- Actual fix: `pnpm install --ignore-scripts` in both Docker stages. Removed python3/make/g++
  toolchain. node:26 UNCHANGED (operator rejected downgrade). Build is pure tsc.
- Real root cause: pnpm 11 ERR_PNPM_IGNORED_BUILDS on unapproved native build scripts; the
  python/git were only a never-needed source-compile fallback (sharp→node-gyp, onnxruntime→cmake+git).
- Validated locally: full `docker build` green; onnxruntime linux binary + @img/sharp-linux-x64
  present in image; @huggingface/transformers loads (voice transcribe/TTS intact).
- CI: tests PASS; "Publish Docker image" workflow re-running on master merge (was the failing job).
