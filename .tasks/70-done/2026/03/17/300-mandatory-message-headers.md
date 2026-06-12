# Feature: Mandatory Message Headers in Multi-Session

## Type

Feature / UX

## Description

When 2+ sessions are active, every outbound bot message must include a header line identifying which session sent it. This lets the operator tell at a glance which agent is talking.

## User Quote

> (from voice — paraphrased) Robot emoji plus the name, no brackets, on its own line. Topic stays in brackets after if there is one.

## Dependencies

- **100-sid-required-all-tools** — must know which session is sending to apply the correct header

## Current State

The outbound proxy (`src/outbound-proxy.ts`) already intercepts all `sendMessage`, file sends, and `editMessageText` calls. Topic prefix injection is done per-tool via `applyTopicToText()` from `src/topic-state.ts`. Neither layer currently injects session identity.

## Format

```text
🤖 Scout
[Refactor Agent] Here is the analysis you requested...
```

- Line 1: Robot emoji + session name (no brackets, no bold)
- Line 2+: Topic prefix (if any) + message body (existing behavior)
- Single session active → no header at all (backward compat)

## Code Path

### Where to inject

Two options — choose one:

### Option A: Outbound proxy (recommended)

Inject in `src/outbound-proxy.ts` `proxiedSendMessage` (L151-184). The proxy already wraps every `sendMessage` call. Add the header as a prefix to `text` before sending. This catches ALL outbound messages from ALL tools with zero per-tool changes.

Needs: access to current session's name. The proxy would call `getSession(getActiveSession())?.name` from `session-manager.ts`.

### Option B: Per-tool injection (like topic)

Create `applySessionHeader(text, sid)` in a new module, import in each tool. More explicit but requires touching every tool file.

### Interaction with topic prefix

Order matters:

1. Session header (line 1): `🤖 Scout`
2. Topic prefix (line 2, if set): `**[Refactor Agent]**`
3. Message body (rest)

If using Option A (proxy), the header is prepended AFTER topic prefix is applied by the tool, so the proxy just prepends one line.

### Files involved

- `src/outbound-proxy.ts` — proxy `sendMessage` / `editMessageText` / file sends (L131-263)
- `src/session-manager.ts` — `getSession(sid)`, `activeSessionCount()`, `getActiveSession()`
- `src/topic-state.ts` — `applyTopicToText()` (must compose correctly with header)
- `src/markdown.ts` — `markdownToV2()` must handle the header line

## Design Decisions

### Why robot emoji?

Distinguishes bot messages from operator messages at a glance. No brackets around the name — brackets are reserved for topic.

### What about file sends / voice sends?

- File sends with captions: prepend header to caption
- Voice sends (`send_text_as_voice`): header is spoken as part of the TTS — probably skip the header for voice, or only apply to the text version

### What about `editMessageText`?

Header should be present in edited messages too if multi-session is active.

### What about reactions / typing / animations?

No header needed — these are not text messages.

## Acceptance Criteria

- [x] All outbound `sendMessage` calls include session header when `activeSessionCount() >= 2`
- [x] Header format: `🤖 {name}\n` prepended to message text
- [x] No header when only 1 session is active
- [x] Topic prefix and session header compose correctly (header first, then topic, then body)
- [x] `editMessageText` includes header in multi-session
- [x] File send captions include header in multi-session
- [x] Voice sends skip header (not a Grammy proxy method — `sendVoiceDirect` bypasses proxy entirely)
- [x] `markdownToV2()` handles the header line without breaking
- [x] Tests: single session → no header
- [x] Tests: multi-session → header present
- [x] Tests: MarkdownV2 name escaping (underscore in name)
- [x] Tests: header in editMessageText
- [x] Tests: file caption header (sendPhoto); omitted when no caption
- [x] Tests: `_rawText` recording also gets header
- [x] Tests: fallback `Session N` when name is empty
- [x] All tests pass: `pnpm test`
- [x] No new lint errors: `pnpm lint`
- [x] Build clean: `pnpm build`

## Completion

**Agent:** GitHub Copilot (worker session)
**Date:** 2026-03-17

### What Changed

- `src/outbound-proxy.ts` — Added imports for `getCallerSid` (session-context),
  `activeSessionCount`/`getSession` (session-manager), and `escapeV2` (markdown).
  Added `buildHeader(escape)` helper that returns `{ plain, formatted }` — plain for
  recording/captions, formatted for MarkdownV2-encoded sends. Injected into:
  - `proxiedSendMessage` — prepends formateed header to `text`; prepends plain header
    to `rawText` (used for `recordOutgoing`)
  - `proxiedFileSend` — prepends plain header to `caption` when caption is present
  - `proxiedEditMessageText` — prepends formatted header to the edit text

- `src/outbound-proxy.test.ts` — Made `getCallerSid`, `activeSessionCount`, `getSession`
  mocks dynamic (vi.hoisted). Added `vi.mock("./session-manager.js")`. Updated `beforeEach`
  to reset these to single-session defaults. Added 9 new tests in a `"session header"`
  describe block covering: multi-session prepend, single-session omit, MarkdownV2 escaping,
  `_rawText` recording, empty-name fallback, photo caption with/without caption, edit text,
  and single-session edit text omit.

### Design Notes

- Topic prefix composition is automatic: tools call `applyTopicToText()` before
  `sendMessage`, producing `[Topic] body`. The proxy then prepends `🤖 Name\n` → result
  is `🤖 Name\n[Topic] body`. Correct order, zero per-tool changes.
- Voice sends (`sendVoiceDirect`) bypass the Grammy proxy via `notifyBefore/AfterFileSend`
  hooks — they correctly get no header (spec says skip for voice).
- `getCallerSid()` uses `AsyncLocalStorage` to get the correct SID even with concurrent
  tool calls from different sessions — race-condition safe.

### Test Results

- Tests added: 9 new (session header describe)
- Total: 1373 (all passing)
- lint: clean
- build: clean
