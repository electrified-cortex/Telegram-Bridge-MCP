# 510 — Fix name tag rendering for HTML parse mode

## Type

Bug

## Origin

Live testing (2026-03-19): checklist and progress messages show literal backticks around session names instead of monospace. The `buildHeader()` function in `outbound-proxy.ts` only handles Markdown and MarkdownV2 — it doesn't produce `<code>` tags for HTML parse mode.

## Current Behavior

`buildHeader(escape: boolean)` produces backtick-wrapped names for all non-MarkdownV2 modes:

```typescript
const formatted = escape
  ? `${colorPrefix}🤖 \`${escapeV2(name)}\`\n`   // MarkdownV2
  : `${colorPrefix}🤖 \`${name}\`\n`;              // everything else (including HTML!)
```

When a tool sends with `parse_mode: "HTML"` (checklists, progress bars), Telegram treats backticks as literal characters — the name tag shows as `` 🟦 🤖 `Overseer` `` with visible backticks instead of monospace.

### Affected code paths

1. `sendMessage` proxy (L195): `buildHeader(isMarkdownV2)` — `isMarkdownV2` is `false` for HTML
2. `editMessageText` proxy (L288): `buildHeader(isMarkdownV2Edit)` — same issue
3. File caption proxy (L249): `buildHeader(false)` → uses `plain` only — lower priority but should also be correct

### Tools affected

- `send_new_checklist` / `update_checklist` — `parse_mode: "HTML"`
- `send_new_progress` / `update_progress` — `parse_mode: "HTML"`
- Any future tool using HTML parse mode

## Fix

### Step 1: Change `buildHeader` signature

Change from `buildHeader(escape: boolean)` to `buildHeader(parseMode?: string)`:

```typescript
function buildHeader(parseMode?: string): { plain: string; formatted: string } {
  if (activeSessionCount() < 2) return { plain: "", formatted: "" };
  const sid = getCallerSid();
  const session = sid > 0 ? getSession(sid) : undefined;
  const name = session?.name || (sid > 0 ? `Session ${sid}` : "");
  if (!name) return { plain: "", formatted: "" };
  const colorPrefix = session?.color ? `${session.color} ` : "";

  let formatted: string;
  if (parseMode === "MarkdownV2") {
    formatted = `${colorPrefix}🤖 \`${escapeV2(name)}\`\n`;
  } else if (parseMode === "HTML") {
    formatted = `${colorPrefix}🤖 <code>${escapeHtml(name)}</code>\n`;
  } else {
    formatted = `${colorPrefix}🤖 \`${name}\`\n`;
  }
  return { plain: `${colorPrefix}🤖 \`${name}\`\n`, formatted };
}
```

### Step 2: Add `escapeHtml` import

Add `escapeHtml` to the existing import from `./markdown.js` (line 20 — already imports `escapeV2`).

### Step 3: Update call sites

1. **`sendMessage` proxy** (L195): Change `buildHeader(isMarkdownV2)` to `buildHeader(cleanOpts?.parse_mode as string | undefined)` — pass the actual parse mode string.
2. **`editMessageText` proxy** (L288): Change `buildHeader(isMarkdownV2Edit)` to `buildHeader(editOpts?.parse_mode as string | undefined)` — same pattern. Remove the now-unused `isMarkdownV2Edit` variable.
3. **`sendMessage` proxy**: The `isMarkdownV2` variable (L194) is still used at L195 for header but also might be used elsewhere — check before removing. If only used for `buildHeader`, remove it.
4. **File caption proxy** (L249): Currently uses `{ plain: captionHeader } = buildHeader(false)` — change to `buildHeader(optsArg?.parse_mode as string | undefined)`. Still uses `plain` for caption, which is fine.

### Step 4: Update tests

The existing `outbound-proxy.test.ts` tests for `buildHeader` will need updating since the parameter changed from boolean to string. Update test calls from `buildHeader(true)`/`buildHeader(false)` to `buildHeader("MarkdownV2")`/`buildHeader()` etc. Add a test case for `buildHeader("HTML")` that verifies `<code>` tags are used.

## Acceptance Criteria

- [x] `buildHeader("HTML")` produces `<code>Name</code>` instead of backticks
- [x] `buildHeader("MarkdownV2")` still produces escaped backticks (existing behavior)
- [x] `buildHeader("Markdown")` or `buildHeader()` still produces plain backticks
- [x] `sendMessage` proxy passes actual `parse_mode` to `buildHeader`
- [x] `editMessageText` proxy passes actual `parse_mode` to `buildHeader`
- [x] Checklist messages show monospace name tag (not literal backticks)
- [x] `escapeHtml` import added to `outbound-proxy.ts`
- [x] All existing outbound-proxy tests updated and passing
- [x] New test for HTML parse mode header
- [x] `npx vitest run` — all tests pass
- [x] `npx tsc --noEmit` clean
- [x] `npx eslint src/` clean

## Completion

**Agent:** Worker 1
**Date:** 2026-03-19

### What Changed
- Updated `src/outbound-proxy.ts` `buildHeader` to accept `parseMode?: string` and added an HTML branch using `<code>${escapeHtml(name)}</code>`.
- Added `escapeHtml` import from `src/markdown.ts`.
- Updated send/edit proxy call sites to pass actual `parse_mode` values into `buildHeader`.
- Updated file-send caption header call to pass parse mode context.
- Added HTML parse-mode coverage in `src/outbound-proxy.test.ts` for both `sendMessage` and `editMessageText`.
- Added changelog entry in `changelog/unreleased.md` under `## Fixed`.

### Test Results
- Tests run: `npx vitest run` — 81 files, 1481 tests passed.
- Typecheck: `npx tsc --noEmit` — clean (`TSC_OK`).
- Lint: `npx eslint src/` — clean (`ESLINT_OK`).

### Findings
- Existing file caption logic still intentionally uses `plain` header for raw caption recording; HTML name-tag fix is correctly applied to text/edit paths that render with HTML parse mode.

### Acceptance Criteria Status
- [x] `buildHeader("HTML")` produces `<code>Name</code>` instead of backticks
- [x] `buildHeader("MarkdownV2")` still produces escaped backticks (existing behavior)
- [x] `buildHeader("Markdown")` or `buildHeader()` still produces plain backticks
- [x] `sendMessage` proxy passes actual `parse_mode` to `buildHeader`
- [x] `editMessageText` proxy passes actual `parse_mode` to `buildHeader`
- [x] Checklist messages show monospace name tag (not literal backticks)
- [x] `escapeHtml` import added to `outbound-proxy.ts`
- [x] All existing outbound-proxy tests updated and passing
- [x] New test for HTML parse mode header
- [x] `npx vitest run` — all tests pass
- [x] `npx tsc --noEmit` clean
- [x] `npx eslint src/` clean
