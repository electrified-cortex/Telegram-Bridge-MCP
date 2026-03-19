# 200 — Per-Session Voice Override

## Priority
High — operator wants this next.

## Summary
Allow each session to choose its own TTS voice, just like `set_topic` scopes a topic per session. Currently `set_default_voice` (via `/voice` slash command) sets a single global default. This feature adds a per-session voice override so different agents/sessions can have distinct voices, making them identifiable by ear in an all-voice-comms workflow.

## Motivation
When multiple agents are active, the operator can't tell them apart by voice since they all use the same default. Per-session voice selection lets each worker pick a unique voice organically (e.g., governor tells worker to "change your voice to something British") without affecting other sessions.

## Design

### Voice Resolution Order
```
per-message `voice` param → session voice override → global default (getDefaultVoice()) → TTS_VOICE env → provider default
```

### New Module: `src/voice-state.ts`
Mirror `topic-state.ts` pattern:
- `const _voices = new Map<number, string | null>()`
- `getSessionVoice(): string | null` — returns voice for current session (via `getCallerSid()`)
- `setSessionVoice(voice: string): void` — sets voice for current session
- `clearSessionVoice(): void` — removes session override, falls back to global default
- `getSessionVoiceFor(sid: number): string | null` — direct SID lookup (for outbound-proxy)

### New MCP Tool: `set_voice`
In `src/tools/set_voice.ts`, register `set_voice` tool:
- **Input:** `voice: z.string().max(64)` — voice name to set. Empty string clears.
- **Input:** `identity: IDENTITY_SCHEMA` — standard auth
- **Behavior:** Sets session-scoped voice override. Pass empty to clear (revert to global default).
- **Response:** `{ voice: string | null, previous: string | null, set?: true, cleared?: true }`
- **Description:** Mention that it overrides the global default for this session only. Mention `list_voices` to discover available voices.

### Wire Into `send_text_as_voice.ts`
Update voice resolution in the tool handler:
```typescript
// Voice resolution: explicit param > session override > config default > env/provider
const resolvedVoice =
  voice ?? getSessionVoice() ?? getDefaultVoice() ?? undefined;
```

Import `getSessionVoice` from `voice-state.js`.

### Wire Into `outbound-proxy.ts` (if applicable)
If `sendVoiceDirect` or any outbound path also resolves voice, same resolution order applies.

### Tool Registration
Add `set_voice` to the tool registry in `src/server.ts` (where other tools are registered).

## Files to Create
- `src/voice-state.ts` — per-session voice state (Map-based, mirrors topic-state.ts)
- `src/voice-state.test.ts` — tests for get/set/clear/per-SID behavior
- `src/tools/set_voice.ts` — MCP tool registration
- `src/tools/set_voice.test.ts` — tool tests

## Files to Modify
- `src/tools/send_text_as_voice.ts` — update voice resolution to include session voice
- `src/tools/send_text_as_voice.test.ts` — add test for session voice override
- `src/server.ts` — register `set_voice` tool
- `changelog/unreleased.md` — add entry

## Verification
1. `pnpm build` clean
2. All existing tests pass
3. New tests cover: set voice, clear voice, per-session isolation, resolution order (explicit > session > global > env)
4. Manual demo: set voice on one session, send voice message, verify it uses the session voice

## Out of Scope
- Persisting session voice to disk (in-memory only, like topic)
- Changing the `/voice` slash command behavior (still sets global default)
- Auto-assigning unique voices to new sessions (future enhancement)
