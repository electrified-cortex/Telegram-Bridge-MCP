---
id: "10-1900"
title: "TMCP: block + report absolute paths in send/append messages, with `safety` override"
priority: 10
status: queued
created: 2026-04-28
repo: Telegram MCP
delegation: Curator | Worker
---

# 10-1900 - TMCP block-and-report absolute paths

## Context

Agents (and humans) repeatedly leak absolute filesystem paths into Telegram messages. Examples in this session: `<drive>:/Users/<user>/Development/...` paths in narration, code-block context, error messages. Operator's no-abs-paths rule is hard, but compliance has been imperfect across multiple agents and across many turns.

The unrenderable-chars warning system (Unicode arrows etc) already exists at the bridge layer. Same shape can detect absolute paths and either block or warn.

## Acceptance Criteria

1. [x] Bridge inspects every outbound message body (and audio caption) for absolute-path patterns:
   - Windows drive-letter prefix: `<letter>:[/\\]<...>` (e.g. `D:/`, `C:\`, `D:\\Users`)
   - Unix root-anchored common dev paths: `/Users/`, `/home/`, `/d/`, `/c/`, `/mnt/`, `/usr/local/`
   - Configurable allowlist if desired (e.g. `/usr/bin/` shell utilities OK).
2. [x] Default behavior: **block** the send. Return an error response to the agent indicating an absolute path was detected, with the offending substring. Mirrors the existing unrenderable-chars warning pattern but is enforcement, not advisory.
3. [x] **Override**: agent can pass `safety: "disable"` (or `safety: false`, exact name TBD during spec) on the `send` / `send_file` / `action` calls. When present, the abs-path check is skipped and the message goes through. Operator notification is emitted (service message) when an override is used.
4. [x] Error message back to the agent should be specific:
   - Which substring triggered the block.
   - Suggested replacement (`<workspace>/...` or `<repo>/...` placeholder).
   - Override instruction: "If you genuinely need to send this path, retry with `safety: \"disable\"` on the call." Agent learns the escape hatch in-band; no out-of-band documentation lookup needed.
5. [x] Test fixtures: messages with abs-paths (block expected), messages with placeholders (allow), messages with abs-path AND `safety: disable` (allow + audit log).
6. [x] Spec'd in TMCP repo's spec/ folder (if structure exists) or a new `safety/abs-path-block.spec.md`.

## Why Curator-only / Worker-OK

- Lives in TMCP repo (Telegram MCP Bridge), not the workspace skills.
- Implementation requires pwsh / bash bridge familiarity. Worker can author with operator review on the bridge side.

## Related

- Service message pattern: existing `unrenderable_chars_warning` at TMCP for Unicode chars (advisory). New `abs_path_block` is enforcement.
- Mojibake/Unicode scrubber tool (workspace task `10-1620`) is the producer-side mitigation; this task is the consumer-side gate.
- Operator memory: "ASCII arrows (strict)" + "No absolute paths in artifact bodies" — this enforces the latter at the Telegram boundary.

## Open Questions

- Override key name: `safety: "disable"` vs `safety: false` vs `_abs_path_override: true` vs something else. Bikeshed during spec.
- Does override require operator-issued ticket (one-time approval per session) or unlimited per-call? Probably per-call but logged.
- Audio caption inspection: should TTS-converted audio be checked for path mentions in the source text? Yes — TTS speaks the path, so block.
- File path field on `send_file`: legitimate absolute path required. Carve-out: `file:` field is exempt; only `text:` / `caption:` body checked.

## Verification

- **Verdict:** APPROVED (verifier a622eabd64038f3cf)
- **Squash commit:** 74bcf5e4 on release/v7.11.1
- **Tests:** 3847/3847 pass (159 files)
- **Sealed:** 2026-06-22 by foreman

## Operator Amendment (2026-06-21, voice 76967)

> "No absolute paths. It's problematic. Unless it's a parameter, then a parameter doesn't matter."

**Clarification on parameter exemption:** Structured parameter fields (e.g. `file:` path in `send_file`, `file:` in `send(type: "file")`) are exempt from absolute-path blocking — these are functional paths, not narration. Only `text:`, `audio:`, and `caption:` body fields are checked. This was already noted in AC-4 ("file: field on send_file is exempt") but the operator's voice confirms it as a hard design principle.
