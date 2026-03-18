# Bug: Global Singletons Not Per-Session

## Type

Bug — Critical

## Found During

Multi-session isolation audit (2026-03-18)

## Description

Four modules use global singletons that are shared across all sessions. When two sessions are active, one session's actions silently corrupt the other's state.

### 1. Topic State (`src/topic-state.ts` L16)

```typescript
let _topic: string | null = null;
```

`set_topic("Refactor Agent")` from S1 is overwritten when S2 calls `set_topic("Test Runner")`. All outbound messages from both sessions get S2's topic prefix.

### 2. Typing State (`src/typing-state.ts` L27-30)

```typescript
let _timer, _safety, _deadline, _generation;
```

S1's `show_typing(20)` is killed if S2 calls `cancelTyping()`. The generation counter is also shared — S1's proxy send might cancel using S2's generation number.

**Nuance:** Telegram's typing API is per-chat (not per-bot-user), so only one typing indicator can exist at a time. But the generation logic must still be per-session to avoid S2's outbound send canceling S1's typing prematurely.

### 3. Temp Message (`src/temp-message.ts` L27)

```typescript
let _pending: PendingTemp | null = null;
```

S1 registers a temp placeholder message. S2 sends any outbound message → outbound proxy calls `clearPendingTemp()` → S1's placeholder is deleted prematurely.

### 4. Temp Reaction (`src/temp-reaction.ts` L23)

```typescript
let _slot: TempReactionSlot | null = null;
```

S1 sets a temporary 👀 reaction. S2 sends any outbound → `fireTempReactionRestore()` fires → S1's reaction is restored/cleared by S2's action.

## Fix

Convert each global to a `Map<number, T>` keyed by SID, matching the pattern already used by `animation-state.ts` (`_states: Map<number, AnimationState>`) and `session-queue.ts`.

## Acceptance Criteria

- [ ] `_topic` → `Map<number, string | null>` — each session has its own topic
- [ ] `_timer`/`_generation` etc. → `Map<number, TypingState>` — per-session typing
- [ ] `_pending` → `Map<number, PendingTemp | null>` — per-session temp message
- [ ] `_slot` → `Map<number, TempReactionSlot | null>` — per-session temp reaction
- [ ] Outbound proxy hooks operate on correct session's state via `getCallerSid()`
- [ ] All tests pass
- [ ] S1's topic/typing/temp state unaffected by S2's actions
