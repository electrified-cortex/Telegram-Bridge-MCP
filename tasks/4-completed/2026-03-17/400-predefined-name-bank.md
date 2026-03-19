# Story: Predefined Session Name Bank

## Type

Story — Design Discussion

## Priority

400 (normal — future enhancement, not blocking)

## Origin

Operator voice message (2026-03-18):
> "Maybe predefined names. A bank of names they can choose from. With a number at the end. Worker 01, Scout, whatever. It's not a make up a name, it's a choice."

## Description

Instead of allowing agents to choose arbitrary names (even with alphanumeric restrictions from task 250), provide a predefined bank of session names that agents must select from.

## Potential Design

### Name Bank

A curated list of agent names, possibly configurable:

```
Scout, Worker, Analyst, Builder, Reviewer, Checker, Runner, Watcher, Planner, Fixer
```

### Numbering

When a name is already taken, append a number suffix: `Scout 01`, `Worker 02`, etc.

### Configuration

- Default bank built into the server
- Optionally overridable via env var or config: `SESSION_NAME_BANK="Scout,Worker,Builder"`
- Could also be set dynamically by the governor

### Trade-offs

**Pros:**

- Eliminates naming conflicts entirely
- No risk of impersonation (no "Admin", "System" names)
- Consistent, predictable naming across sessions
- Agents don't need to think about naming — just pick one

**Cons:**

- Less expressive — agents can't describe their role in their name
- Topic already serves the "what am I doing" purpose
- Adds rigidity to a system that might benefit from flexibility

### Open Questions

- Should the first session (S1) auto-assign a name or choose?
- Should the governor be able to assign names to incoming sessions?
- Should the name bank be fixed or configurable?
- How does this interact with `rename_session` (task 500)?

## Acceptance Criteria

_Not yet scoped — this is a design discussion task._

- [x] Decision on whether to implement name bank vs. keep free-text with validation
- [ ] If yes: define the name list, numbering scheme, and configuration approach
- [x] If no: document why and close

## Decision (2026-03-18): Deferred — keep free-text with validation

**Decision:** Do not implement a predefined name bank at this time. Keep the current free-text system with alphanumeric validation and collision guard.

**Reasoning:**

1. **Existing validation is sufficient** — the alphanumeric restriction (task 250) already prevents names like "System", "Admin", or emoji-based impersonation. The collision guard prevents duplicates.
2. **Operator approval is the real trust gate** — second+ sessions require explicit operator approval before creation, which provides a stronger safeguard than a name list.
3. **Flexibility matters** — agents benefit from descriptive names that express their actual role in the current context (e.g. "Code Reviewer", "Test Runner"). A fixed bank prevents this.
4. **Topic already serves the role-description purpose** — the `topic` field per session is the right place for role context; the name is just an identifier.
5. **rename_session (task 500) subsumes the flexibility concern** — once sessions can rename, the "pick one from a list" pattern can be implemented by the governor at runtime without hardcoding names server-side.
6. **Numbering complexity adds cost** — auto-numbering collisions ("Scout 01", "Scout 02") adds state tracking and display complexity for uncertain benefit.

**Future revisit trigger:** If operator feedback after broader multi-session use shows that agents choose confusing or conflicting names despite validation, a configurable name bank (via config.json `SESSION_NAME_BANK`) can be added then. The operator's original voice note is preserved here as a reference.
