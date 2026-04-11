# 10-419: Fix `send(voice: ...)` → `send(audio: ...)` in telegram-communication instructions

**Priority:** 10 (critical — agent-facing docs with wrong API parameter)
**Scope:** `.github/instructions/telegram-communication.instructions.md`
**Branch:** `dev`
**PR:** #126 (Copilot comment 3054936153)

## Problem

`.github/instructions/telegram-communication.instructions.md` still instructs agents to use `send(voice: ...)` for TTS/spoken content (lines 33 and 48). The `send` tool's actual parameter is `audio`, not `voice` (see `src/tools/send.ts` line 106). The `voice` parameter does not exist in the v6 API surface.

Agents following these instructions will make invalid tool calls, causing TTS to silently fail or produce an error.

**Bad (current):**
```
send(voice: ...) — default for most responses   ← line 48
Use send(voice: ...) for conversational replies  ← line 33
```

**Correct:**
```
send(audio: ...) — default for most responses
Use send(audio: ...) for conversational replies
```

## Root Cause

Task 10-205 renamed `voice` to `audio` in the implementation but did not update agent-facing instruction files. The `telegram-communication.instructions.md` file was missed.

## Spec

Update `.github/instructions/telegram-communication.instructions.md`:

1. **Line 33** (Non-Negotiable Rules §9): Replace `send(voice: ...)` with `send(audio: ...)` in both the inline reference and the surrounding description.
2. **Line 48** (Tool Selection table): Replace `send(voice: ...)` with `send(audio: ...)` in the "Conversational reply" row.
3. Verify no other occurrences of `send(voice:` remain in the file.

### NOT in scope
- `docs/communication.md` (check separately if needed)
- `set_voice` tool references (correct — that's voice *selection*, different concept)
- Internal `voice` parameter inside nested objects (e.g., `audio: {text: "...", voice: "am_onyx"}`) — those are correct

## Acceptance Criteria
- [ ] `send(voice: ...)` no longer appears in `.github/instructions/telegram-communication.instructions.md`
- [ ] `send(audio: ...)` is used consistently throughout the file for TTS/spoken content
- [ ] The Tool Selection table row for "Conversational reply" shows `send(audio: ...)`
- [ ] Rule 9 in "Non-Negotiable Rules" references `send(audio: ...)`
- [ ] No other agent-facing `.instructions.md` files contain `send(voice:`
- [ ] `npm run build` passes (doc-only change, should be trivial)

## Reversal
Replace `send(audio: ...)` back to `send(voice: ...)` in the same two locations. Pure text swap, no logic changes.
