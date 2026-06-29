---
id: 10-3077
title: "TMCP: HTTP file-transfer endpoint for agent send/download (replaces SAFE_FILE_DIR restriction)"
priority: P1
status: draft
category: Feature/Bug
filed: 2026-06-28
source: TG 65419
repo: electrified-cortex/Telegram-Bridge-MCP
branch_target: worker/tmcp-p4-http-file-transfer
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
---

# 10-3077: HTTP File-Transfer Endpoint

## Problem

Agents cannot send locally-generated files (TTS output, reports, screenshots) via TMCP.
`resolveMediaSource` in `src/telegram.ts` hard-blocks any path not under `SAFE_FILE_DIR`
(`/tmp/telegram-bridge-mcp`). This path check was a security hardening addition (v5/v6)
that became a correctness regression for agents running outside the bridge container.

The voice send path (`sendVoiceDirect`) has a further defect: it throws an unhandled
exception rather than returning a structured error when the path fails the check.

Download is separately broken when `BOT_TOKEN` is absent from the agent's environment
(explicit error but no recovery path).

## Operator's fix direction (TG 65419)

Avoid local file-system coupling entirely. MCP cannot stream binary, so TMCP falls back to
file paths — and the SAFE_FILE_DIR sandbox is the blocker. The solution: add a token-gated
HTTP endpoint to the bridge so agents transfer files over HTTP rather than local paths.

**Pattern** (mirrors S-IM's HTTP+token model):
- `POST /files` — authenticated upload; returns a one-time transfer URL
- `GET /files/<id>` — authenticated download; serves the file, then expires the token

The MCP tools (`send_file`, `download_file`) reference the HTTP URL returned by the upload,
not a local path. No SAFE_FILE_DIR expansion needed.

## Scope

### HTTP layer (new)

- `POST /files` — requires `Authorization: Bearer <session_token>`. Accepts multipart or
  raw body. Returns `{ url: "http://localhost:<port>/files/<uuid>", expires_in: 300 }`.
  File stored in-memory (or temp dir) with a 5-minute TTL.
- `GET /files/<uuid>` — requires the same session token or a one-time download token.
  Streams the file body; deletes from store on first successful download.

### MCP tool changes

- `send_file` (action tool): accept `url` as an alternative to `file_path`. When `url` is
  provided, bridge fetches the content from the URL and sends to Telegram. No SAFE_FILE_DIR
  check needed for URL sources.
- `download_file` (action tool): return a `GET /files/<uuid>` URL pointing to the bridge,
  in addition to (or instead of) writing to local disk. Agent retrieves via HTTP.
- `sendVoiceDirect` crash fix: replace unhandled throw with `return toError(...)`.

### What does NOT change

- Existing `send_file` with `file_path` inside SAFE_FILE_DIR continues to work (backward compat).
- Telegram bot token resolution (`BOT_TOKEN`) is unchanged.
- No change to session auth middleware.

## Acceptance Criteria

- [ ] `POST /files` with a valid session token accepts a file body and returns a JSON response
      containing a `url` field pointing to `GET /files/<uuid>`
- [ ] `GET /files/<uuid>` returns the uploaded file body and responds with the correct
      `Content-Type`; a second request to the same UUID returns 404 (one-time token)
- [ ] `action(type: "send_file", url: "http://localhost:<port>/files/<uuid>", token: ...)`
      sends the file to Telegram without triggering the SAFE_FILE_DIR path check
- [ ] `action(type: "download_file", ...)` returns a bridge-hosted download URL in the response
- [ ] `sendVoiceDirect` returns a structured error (not a throw) when the source path is
      outside SAFE_FILE_DIR
- [ ] File entries with no download within TTL (300s default) are evicted from the store
- [ ] `cargo`-style: `npm run build` succeeds, existing unit tests pass
- [ ] Worker smoke test: upload a small PNG via `POST /files`, send it to Telegram via
      `send_file(url: ...)`, confirm message appears in chat

## Worker notes

- Root file: `src/telegram.ts` — `resolveMediaSource` function; voice path `sendVoiceDirect`
- New HTTP routes: add to the existing Express/Fastify server (check `src/server.ts` or `src/index.ts`)
- In-memory file store: `Map<uuid, { buffer: Buffer; contentType: string; expiresAt: number }>`;
  use `setInterval` for TTL eviction (clear on server shutdown)
- UUID generation: `crypto.randomUUID()` (Node built-in, no new deps)
- Content-Type sniffing: use `file-type` if already in package.json; otherwise pass through
  the Content-Type from the upload request

## Worktree

Branch: `worker/tmcp-p4-http-file-transfer`
Directory: `.git/.wt/tmcp-p4-http-file-transfer`
Base: `dev` at current HEAD

## Gate review

- reviewer: gate
- date: 2026-06-28
- verdict: PASS
- review type: adversarial gate
- checked: ACs 1-7 binary+testable (AC8 smoke test is validation-only, not gatable — accepted); scope has explicit IN/OUT list; auth requirement stated (session token on POST/GET); one-time download pattern correct; TTL eviction prevents accumulation; UUID via crypto.randomUUID() — no new deps
- fixed: corrected Base branch from `main` → `dev` in worker notes
- notes: (1) Worker must ensure 401 is returned on invalid/missing token for POST /files (happy-path ACs don't cover auth rejection — add a unit test). (2) Express/Fastify ambiguity in worker notes is acceptable — worker discovers from src/server.ts. (3) In-memory store acceptable for v1 — TTL eviction prevents unbounded growth. (4) TMCP harness-agnostic rule applies to any new MCP tool descriptions.
<!-- overseer-gate: PASS 2026-06-28 -->

## Verification

- **verified-by**: foreman (post-gate adversarial review + Overseer gate APPROVED)
- **date**: 2026-06-28
- **verdict**: PASS
- **squash_commit**: TBD
- **gate-holds-cleared**: auth-before-body (security: isValidAuthHeader moved before readBodyBuffer in POST /files handler); structured VOICE_RESTRICTED throw in sendVoiceDirect
- **tests**: 4194/4194 passing (171 source files, HEAD c04bca65)
- **notes**: file-store.ts (new in-memory TTL store), file-transfer-endpoint.ts (POST/GET /files with 401→400→store flow), send/file.ts (new), download/file.ts (bridge_url field), tools/action.ts (send_file registered). Auth-before-body gate-hold fixed per Overseer GATE FINAL directive.
