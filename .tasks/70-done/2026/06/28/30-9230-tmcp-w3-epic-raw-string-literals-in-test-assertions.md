---
created: 2026-06-27
status: queued
overseer-stamp: PASS — 2026-06-28T02:39Z
priority: 5
source: TMCP V8 quality audit wave 3 (unit-test-snob), 2026-06-28 — consolidated epic
repo: electrified-cortex/Telegram-Bridge-MCP
type: TechDebt
severity: high
persona: unit-test-snob
pattern: raw-string-literals
agent_type: Worker
model_class: sonnet-class
reasoning_effort: high
---

# TMCP Overhaul [unit-test-snob Epic]: Raw String Literals Copied from Production into Test Assertions

**ID**: 30-9230
**Date**: 2026-06-27
**Persona**: unit-test-snob
**Pattern**: Raw production strings duplicated into assertions instead of exported constants

## Problem

Across 8 test files, production string values (error messages, UI labels, parse-mode identifiers, protocol method names, format strings) are copy-pasted verbatim into test assertion arguments. None of these strings are exported constants in the source modules. This creates two-way drift: when a developer changes the production string, the test silently diverges and either (a) fails for a presentational reason unrelated to behavior, or (b) still passes because the assertion was already stale. The pattern is especially destructive when a single string is duplicated 5–12 times (e.g., `"MarkdownV2"` appears 12 times in animation-state.test.ts; `"This panel has expired."` appears at 5 production sites and 2 test sites). Fixing one copy does not fix the others — they drift in silence.

The canonical repair is to export a named constant from the production module and import it in the test, eliminating the duplicate entirely. Where the assertion is testing UI copy rather than behavior (descriptions, emoji banners, human-readable error prose), the correct fix is often to drop the string assertion altogether and assert on structural/behavioral properties instead.

## Covers

Consolidates the following wave-3 source tasks (all now in `.tasks/.trash/`):

| ID | File | Issue |
|----|------|-------|
| 30-9200 | animation-state.test.ts line 158 | `"ALLOWED_USER_ID not configured"` raw error string |
| 30-9201 | animation-state.test.ts (12 sites) | `"MarkdownV2"` repeated as inline literal |
| 30-9202 | animation-state.test.ts line 1247 | `"Persistent animation still active"` warning prose |
| 30-9203 | activity-listen-check-endpoint.test.ts lines 56, 74, 88, 147, 155 | `"token is required"` / `"invalid token"` / `"AUTH_FAILED"` |
| 30-9207 | built-in-commands.test.ts lines 237-246 | Deep-equal snapshot of BUILT_IN_COMMANDS with raw description strings |
| 30-9208 | built-in-commands.test.ts lines 1109, 1123, 1138, 1230, 1246 | `"Session Auto-Approve -> ..."` approve-mode UI strings |
| 30-9209 | built-in-commands.test.ts lines 1431-1435, 1445-1449 | Verbatim session-close result strings |
| 30-9210 | built-in-commands.test.ts lines 487, 1149 | `"This panel has expired."` duplicated twice |
| 30-9214 | async-send-queue.test.ts lines 368-391 | `"⚠ [async failed]"` banner string |
| 30-9223 | channel.test.ts lines 173-177 | `"notifications/resources/updated"` MCP protocol method |
| 30-9226 | compaction-recovery.test.ts line 80 | `"ℹ️ *Compacted*"` from private production constant |
| 30-9228 | config.test.ts lines 144, 147, 153 | `"every 50 messages"` / `"disabled"` format strings |
| 30-9229 | debug-log.test.ts line 43 | `"[dbg:queue] enqueue test"` format-string implementation detail |

## Representative Offending Code

### Pattern A — inline error string (30-9200)
```typescript
// animation-state.test.ts line 158
await expect(startAnimation(1)).rejects.toThrow("ALLOWED_USER_ID not configured");
```

### Pattern B — parse mode string repeated 12 times (30-9201)
```typescript
// animation-state.test.ts line 90 (and 11 more occurrences)
expect(mocks.sendMessage).toHaveBeenCalledWith(123, "🔄", {
  parse_mode: "MarkdownV2",
  disable_notification: true,
});
```

### Pattern C — full UI constant deep-equal snapshot (30-9207)
```typescript
// built-in-commands.test.ts lines 237-246
expect(BUILT_IN_COMMANDS).toEqual([
  { command: "logging", description: "Logging controls" },
  { command: "voice", description: "Change the TTS voice" },
  // ...all entries with raw description strings
]);
```

### Pattern D — private constant value copied verbatim (30-9226)
```typescript
// compaction-recovery.test.ts line 80
expect(mocks.cancelAnimation).toHaveBeenCalledWith(1, "ℹ️ *Compacted*", "MarkdownV2");
```

## Fix

For each occurrence, apply the appropriate repair in priority order:

**Repair A — Export and import the constant:**
```typescript
// BEFORE (animation-state.ts — production, not exported):
throw new Error("ALLOWED_USER_ID not configured");

// AFTER (animation-state.ts):
export const ERR_NO_CHAT_ID = "ALLOWED_USER_ID not configured";
// ...
throw new Error(ERR_NO_CHAT_ID);

// BEFORE (animation-state.test.ts line 158):
await expect(startAnimation(1)).rejects.toThrow("ALLOWED_USER_ID not configured");

// AFTER:
import { ERR_NO_CHAT_ID } from "./animation-state.js";
await expect(startAnimation(1)).rejects.toThrow(ERR_NO_CHAT_ID);
```

**Repair B — Export parse-mode constant, use it everywhere (30-9201):**
```typescript
// BEFORE (animation-state.ts):
// "MarkdownV2" is inline at every call site, never a constant

// AFTER (animation-state.ts or shared constants):
export const PARSE_MODE = "MarkdownV2" as const;

// BEFORE (animation-state.test.ts, 12 occurrences):
expect(mocks.sendMessage).toHaveBeenCalledWith(123, "🔄", {
  parse_mode: "MarkdownV2",
  disable_notification: true,
});

// AFTER:
import { PARSE_MODE } from "./animation-state.js";
expect(mocks.sendMessage).toHaveBeenCalledWith(123, "🔄", {
  parse_mode: PARSE_MODE,
  disable_notification: true,
});
```

**Repair C — Assert on structure not prose for BUILT_IN_COMMANDS (30-9207):**
```typescript
// BEFORE (built-in-commands.test.ts lines 237-246):
expect(BUILT_IN_COMMANDS).toEqual([
  { command: "logging", description: "Logging controls" },
  { command: "voice", description: "Change the TTS voice" },
  // ...full snapshot with description strings
]);

// AFTER:
const commandNames = BUILT_IN_COMMANDS.map(c => c.command);
expect(new Set(commandNames)).toEqual(new Set(["logging", "voice", /* ...expected names */]));
expect(BUILT_IN_COMMANDS.every(c => typeof c.description === "string" && c.description.length > 0)).toBe(true);
```

**Repair D — Export private constant (30-9226):**
```typescript
// BEFORE (compaction-recovery.ts):
const COMPACTED_NOTIFY_TEXT = "ℹ️ *Compacted*";      // private
const COMPACTED_NOTIFY_PARSE_MODE = "MarkdownV2";     // private

// AFTER:
export const COMPACTED_NOTIFY_TEXT = "ℹ️ *Compacted*";
export const COMPACTED_NOTIFY_PARSE_MODE = "MarkdownV2";

// BEFORE (compaction-recovery.test.ts line 80):
expect(mocks.cancelAnimation).toHaveBeenCalledWith(1, "ℹ️ *Compacted*", "MarkdownV2");

// AFTER:
import { COMPACTED_NOTIFY_TEXT, COMPACTED_NOTIFY_PARSE_MODE } from "./compaction-recovery.js";
expect(mocks.cancelAnimation).toHaveBeenCalledWith(1, COMPACTED_NOTIFY_TEXT, COMPACTED_NOTIFY_PARSE_MODE);
```

**Repair E — Drop assertion on prose, keep behavioral check (30-9202, 30-9208, 30-9228, 30-9229):**
Where the asserted string is UI copy (warning messages, panel labels, log prefixes), drop the string assertion entirely and assert on the structural/behavioral property instead. Example for 30-9228:
```typescript
// BEFORE (config.test.ts line 147):
expect(sessionLogLabel()).toBe("every 50 messages");

// AFTER — test that the label encodes the numeric value, not the exact wording:
const label = sessionLogLabel();
expect(label).toMatch(/50/);
expect(label.length).toBeGreaterThan(0);
```

**Files to touch:**
- `src/animation-state.ts` + `src/animation-state.test.ts`
- `src/activity-listen-check-endpoint.ts` + `src/activity-listen-check-endpoint.test.ts`
- `src/built-in-commands.ts` + `src/built-in-commands.test.ts`
- `src/async-send-queue.ts` + `src/async-send-queue.test.ts`
- `src/channel.ts` + `src/channel.test.ts`
- `src/compaction-recovery.ts` + `src/compaction-recovery.test.ts`
- `src/config.ts` + `src/config.test.ts`
- `src/debug-log.ts` + `src/debug-log.test.ts`

## Acceptance Criteria

- [ ] `grep -c '"MarkdownV2"' src/animation-state.test.ts` returns `0`; every former occurrence imports and uses a named constant (e.g. `PARSE_MODE`) from the production module.
- [ ] `grep -c 'ALLOWED_USER_ID not configured' src/animation-state.test.ts` returns `0`; the assertion formerly at line 158 references an exported error constant from `animation-state.ts`.
- [ ] `grep -c '"This panel has expired\."' src/built-in-commands.test.ts` returns `0`; both former assertion sites use the exported `PANEL_EXPIRED_TEXT` constant (or equivalent) from `built-in-commands.ts`.
- [ ] The `toEqual([ { command: "logging", description: "Logging controls" }, ... ])` snapshot is gone from `built-in-commands.test.ts`; the command-name assertion uses `BUILT_IN_COMMANDS.map(c => c.command)` with no raw description strings.
- [ ] `tsc --noEmit` passes and all pre-existing tests pass after the changes.

## Delegation

Worker / Reviewer: Curator; Overseer gate required before merge.

## Verification

- Verifier: af7d943d649aa7823
- Date: 2026-06-28
- Verdict: APPROVED
- AC1 (animation-state: PARSE_MODE): CONFIRMED — "MarkdownV2" literal gone, constant exported+imported
- AC2 (animation-state: ERR_NO_CHAT_ID): CONFIRMED — string literal gone, constant used
- AC3 (built-in-commands: PANEL_EXPIRED_TEXT): CONFIRMED — literal gone, constant exported+imported
- AC4 (built-in-commands: snapshot replaced): CONFIRMED — structural assertion replaces hardcoded command list
- AC5 (tsc + tests pass): CONFIRMED — 4003/4003 pass, tsc clean
