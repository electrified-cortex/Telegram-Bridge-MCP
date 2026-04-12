---
Created: 2026-04-12
Status: Draft
Owner: Curator
---

# Agent Communication Guide — Specification

> This spec defines what the agent communication guide IS, what it contains,
> and how it relates to the help system. Implementation (10-494, 10-496) is
> separate. This is the source of truth for guide design decisions.

## 1. Purpose

The guide is the **communication etiquette and operating rules** reference
for agents using the Telegram Bridge MCP. It defines HOW agents should
behave in Telegram — not how to call tools (that's per-tool help).

**The guide is NOT:**

- A tool reference (per-tool docs live in `help('<tool>')`)
- A startup walkthrough (`help('start')` handles onboarding)
- A configuration manual (profiles, reminders, etc.)

**The guide IS:**

- Operating rules for Telegram communication
- Behavioral patterns (receive → respond flow)
- Etiquette (reactions, typing indicators, animations)
- Compression rules for message content
- Multi-session coordination patterns
- Voice/text/hybrid messaging conventions

## 2. Audience

Agents. Not humans. All content written in ultra compression (Caveman
protocol). Instructions only — no explanations, rationale, or prose.
Explanations live here in the spec.

**Rationale (spec-only):** Agents follow instructions. They don't benefit
from knowing WHY a rule exists. Every explanation word consumed is a token
wasted. If design rationale is needed, it lives in this spec — the one
document that humans read.

## 3. Size Constraint

**Target: ≤8KB (~2K tokens).**

Current guide: ~31KB (~8K tokens). Must shrink by ~75%.

**Rationale (spec-only):** The guide is loaded into agent context via
`help('guide')`. At 31KB, it consumes ~8K tokens before the agent does
any work. Agents that never compact (Workers, Overseer) carry this weight
for their entire session. 2K tokens is the budget for a reference document
that agents may reload after compaction.

## 4. Content Architecture

### 4.1 Help System Hierarchy

```text
help()              → Root menu: what help offers, essential topics
help('start')       → Post-session onboarding (rules + setup + breadcrumbs)
help('guide')       → Full communication etiquette (this document)
help('<tool>')      → Per-tool docs + behavioral guidance
help('compression') → Compression tier reference
help('animation')   → Animation frames guide
help('checklist')   → Checklist step statuses
```

### 4.2 Discovery Rule

**Every help topic must be reachable via breadcrumb.** No orphaned topics.

A topic is reachable if at least one of these is true:

- Listed in the `help()` root menu
- Referenced as a `→ help('topic')` breadcrumb in another topic
- Included as a hint in a tool response

Audit criterion: if a topic has zero inbound references, it's orphaned
and must be connected or removed.

**Enforcement:** Task 10-496 establishes the initial index. Task 10-502
(help-to-markdown) formalizes topics as files. Future audits verify the
index — no CI enforcement needed at this scale.

### 4.3 Content Boundaries

| Content type | Home | NOT in guide |
| --- | --- | --- |
| Communication rules | Guide | |
| Tool API signatures | `help('<tool>')` | ✗ |
| Startup/onboarding | `help('start')` | ✗ |
| Animation syntax | `help('animation')` | ✗ |
| Compression tiers | `help('compression')` | ✗ |
| Checklist statuses | `help('checklist')` | ✗ |
| Dequeue loop pattern | `help('start')` + `help('dequeue')` | ✗ |
| Behavioral per-tool guidance | `help('<tool>')` | ✗ |
| Multi-session coordination | Guide | |
| Shutdown/restart flows | `help('shutdown')` | ✗ |
| Voice/text conventions | Guide | |

**Extraction criteria (deterministic):**

- Content specific to **1 tool** → `help('<tool>')`
- Content spanning **2+ tools** → Guide (cross-cutting)
- Content that is a **startup step** → `help('start')`
- Content that is **explanation/rationale** → this spec or remove

**Examples from current behavior.md:**

| Content | Decision | Reason |
| --- | --- | --- |
| "Use show-typing before every send" | Guide (rule) | Cross-cutting, applies to all tools |
| "send() accepts type, text, audio, reply_to" | `help('send')` | Single tool API |
| "Set profile after session/start" | `help('start')` | Startup step |
| "DM via send(type: 'dm', target_sid: N)" | `help('send')` | Single tool variant |
| "Compression: lite for operator, ultra for agents" | Guide (rule) | Cross-cutting |
| "Shutdown: governor triggers, non-governor receives" | `help('shutdown')` | Single lifecycle event |

### 4.4 MCP Resource Strategy

Agents can load the guide via two channels:

- `help('guide')` — tool call, returns current compressed content
- `telegram-bridge-mcp://agent-guide` — MCP resource preloading

Both channels MUST serve the same compressed guide content. The MCP
resource reads from the same `docs/behavior.md` file. When the guide
is rewritten (10-496), both channels automatically serve the new content.

**No separate governance needed** — single source file, two delivery
mechanisms. But implementation must verify the resource handler reads
from `behavior.md` (not a hardcoded string).

### 4.5 Role Differentiation (Design Decision)

The guide is intentionally universal across all agent roles (Workers,
Curators, Overseers). Rationale:

- All agents share the same Telegram channel and UX surface
- Communication etiquette is role-agnostic (all agents type, react, send)
- Role-specific behavior (delegation patterns, pipeline rules) lives in
  agent files, not the guide
- Filtering adds complexity for marginal savings — most guide content
  applies to every role

If a future role genuinely needs different communication rules, add a
role-tagged section rather than splitting the guide.

## 5. Structure

The guide must contain these sections in order:

### 5.1 Rules (top)

Non-negotiable operating rules. Compression is a RULE. Show typing is
a RULE. These are not suggestions.

```
== Rules ==
Compression: lite → operator. ultra → agents. ALWAYS.
  → help('compression')
Show typing: before every send. Use liberally.
  → help('show-typing')
```

**Reactions are NOT rules.** They belong in the etiquette section (§5.7).
Show-typing is already a form of acknowledgment — agents don't need to
react to everything on top of that.

### 5.2 Tool Shorthand Reference

Define commonly-used tool calls once. Reuse in flow patterns.

```
== Shortcuts ==
TYPING: action(type: 'show-typing')
REACT: action(type: 'react', message_id: <id>, emoji: '👍')
ANIM: send(type: 'animation')
ANIM_THINK: send(type: 'animation', preset: 'thinking')
ANIM_WORK: send(type: 'animation', preset: 'working')
```

### 5.3 Receive-Respond Patterns

Flow patterns for handling incoming messages. Use shorthand references.

```
== On receive ==
Quick reply → TYPING → send(reply_to: <id>)
Need to think → TYPING + ANIM_THINK → process → TYPING → send
Need to work → TYPING + ANIM_WORK → work → TYPING → send
Voice prep → TYPING → send(type: 'text', audio: '...')
Key moment (text) → REACT 👍 + REACT 👀 (temp) → process → TYPING → send → 👍 remains
Reviewing content → REACT 👍 + REACT 👀 (temp) → REACT 🤔 (temp) → review → TYPING → send → 👍 remains
Voice message → (server salutes) → optionally REACT 👀 (temp) → process → TYPING → send → salute remains
  (Don't add 👍 to voice — salute IS the "received" signal)
```

### 5.4 Voice/Text Conventions

When to use voice, text, or hybrid. Simple language for voice. Structured
content in text. Hybrid: audio explains, text formats.

### 5.5 Multi-Session Coordination

DM patterns, routing, governor vs non-governor behavior. Cross-session
etiquette.

### 5.6 Session Lifecycle

Shutdown, restart, reconnect patterns. Brief — link to `help('shutdown')`
for full detail.

### 5.7 Reactions (Etiquette)

Reactions are **great when appropriate.** They optimize the human
experience — acknowledging, signaling attention, expressing sentiment.
The key asymmetry: not reacting is never annoying to the user. Using
reactions inappropriately IS annoying. Err on the side of fewer.

**Principles:**

- Show-typing is already an implicit acknowledgment. Adding a reaction
  on top is optional, not required.
- Use reactions at **key moments** — not reflexively on every message.
- Some built-in automated reactions exist server-side. The guide should
  document what's automated and why, so agents don't duplicate.
- Not reacting = fine. Inappropriate reactions = problem. When in doubt, skip.

**Eyes (👀) — specific guidance:**

The eyes reaction means "I am actively looking at / reviewing this
message." It feels super interactive and connected — one of the most
valuable reactions available. But it is terrible if used wrong.

- **ALWAYS temporary.** Use `temporary: true` when reacting with 👀.
- Drop when done reviewing — permanent eyes looks broken.
- Use for: reviewing specs, reading long messages, inspecting attachments.
- Do NOT use as general acknowledgment (that's what 👍 is for).

**Rationale (spec-only):** Reactions are a powerful UX tool when used
with intention. The temptation for agents is to react to everything —
but that makes the conversation feel robotic and noisy. The guide should
teach appropriate use: react when it adds signal, skip when it doesn't.
Not reacting carries zero cost. Reacting inappropriately carries real
cost — confusion, noise, broken-feeling UX. Eyes in particular: the
interactive "someone is looking at my message" feeling is extremely
valuable human-agent connection, but permanent eyes or misplaced eyes
breaks the illusion completely.

**Guide content for this section:**

```
== Reactions (etiquette) ==
Reactions = great when appropriate. Not reacting = fine.
Inappropriate reactions = annoying. Err toward fewer.
Show-typing already = acknowledgment. Don't stack reflexively.

Automated reactions: audio messages ONLY (salute + transcribe).
  Never automatic for text. Don't duplicate audio reactions.

👀 = "actively reviewing this." ALWAYS temporary: true.
  Drop when done. Permanent 👀 = looks broken.
  Valuable: feels interactive + connected. Terrible if misused.
👍 = general acknowledgment. Use when warranted. Can be permanent.
🤔 = "thinking about this." Temporary. Great layered after 👀.
```

**Reaction layering pattern:**

Reactions support priority levels and temporary flags. This enables a
powerful UX pattern: layer temporary reactions on a permanent base so
the user sees state transitions while a final reaction persists.

**The rule:** If you're going to react at all, don't react and then
erase completely. Either finish with a permanent reaction, or start
with a permanent base and layer temporaries on top. When temporaries
clear (on send, on timeout), the permanent base remains. The user
should always see a final reaction — never an empty state after
seeing a reaction appear.

**Example flow (text message, full engagement):**

```
1. REACT 👍 (priority: -1)          — permanent base, sits below everything
2. REACT 👀 (temporary)             — "looking at it" (default pri 0, covers 👍)
3. REACT 🤔 (temporary)             — "thinking about it" (replaces 👀 at pri 0)
4. TYPING → send                    — temps auto-clear, 👍 at -1 remains
```

The agent's mental model: "Set base at -1. Everything else is temporary
with no priority needed."

The user experiences: received → looking → thinking → response → 👍

**Rationale (spec-only):** This is deeply subtle UX. The layering pattern
gives the human a sense of real-time cognitive state from the agent —
received, reading, thinking, responding. The permanent base (👍)
is the safety net: whatever happens with temporaries, the user sees a
final "acknowledged" state. Without the base, clearing temporaries
leaves an empty reaction slot which feels like the agent un-acknowledged
the message. Voice messages don't need this pattern because built-in
server-side reactions already handle the acknowledgment flow (salute
on receive, transcribe indicator).

**Voice messages vs text:**

Voice messages already have the salute reaction (automated, permanent) —
this IS the "received" signal. The permanent base is already there.
Agents should NOT add 👍 on top of voice messages — it's redundant.

However, agents CAN layer temporary reactions on voice messages:

- 👀 (temporary) — "I'm reading the transcript" — great human experience
- 🤔 (temporary) — "thinking about it" — optional, only when processing
  will take a while

The key difference:

| Message type | Permanent base | Agent sets base? | Agent adds temps? |
| --- | --- | --- | --- |
| Text | 👍 (agent) | Yes — must set if reacting at all | Optional |
| Voice | 🫡 salute (server) | No — already present | Optional (👀, 🤔) |

**🤔 thinking reaction:**

Thinking (🤔) as a temporary reaction on the message itself is a
powerful complement to thinking animations. Together with show-typing,
it communicates "I'm thinking about YOUR specific message" rather than
just "I'm working on something." Use `temporary: true` — the thought
is transient.

## 6. Extraction Rules

When auditing the current guide (10-496), apply these criteria:

| Criterion | Action |
| --- | --- |
| Content serves one tool only | Extract → `help('<tool>')` |
| Content duplicates a help topic | Remove from guide, keep in topic |
| Content is a startup step | Extract → `help('start')` |
| Content is explanation/rationale | Move → this spec or remove |
| Content is a code example | Reduce to shorthand reference |
| Content is cross-cutting behavior | Keep in guide (compress) |

## 7. Compression Rules

All guide content must follow ultra compression:

- Drop articles (a/an/the), filler, hedging, pleasantries
- Fragments OK. Short synonyms.
- Code/paths/URLs verbatim
- Pattern: `[thing] [action] [reason].`
- Use shorthand references defined in §5.2

**Never include explanations in agent-facing content.** Agents follow
instructions. If they need to know WHY, the spec is the reference —
but agents don't read specs.

## 8. Help Root Menu

`help()` (no topic) must be redesigned as a CLI-like root menu.
Not a wall of all tools — a concise menu of what help offers:

```
Telegram Bridge MCP — help

Essential:
  help('start')       — post-session setup + rules
  help('guide')       — communication etiquette (full reference)
  help('<tool>')      — per-tool docs

Topics:
  compression, animation, checklist, dequeue, send, ...

All tools: help('tools') or help() with no topic (current behavior → move)
```

The root should be ≤20 lines. The full tool index moves to `help('tools')`.

## 9. Tutorial Mode Integration

(See 10-497 for full spec.)

Tutorial hints supplement the guide by teaching at point-of-use. The guide
is "read-ahead" reference; tutorials are "just-in-time" guidance.

Guide and tutorials should not duplicate content. If a behavioral pattern
is covered by a tutorial hint, the guide can reference it briefly and link
to the tool help.

## 10. Migration Strategy

The guide rewrite affects running agents. Staged rollout:

**Phase 1 — Deploy compressed guide alongside existing topics.**
New `behavior.md` goes live. Existing help topics unchanged. Agents
that call `help('guide')` get the new content. No breakage.

**Phase 2 — Deploy per-tool help topics (10-502).**
Extracted content lands in `docs/help/<topic>.md`. Guide references
the new topics via breadcrumbs. Old embedded topics remain as fallback.

**Phase 3 — Remove old embedded topics.**
Once all topics are on disk, remove embedded strings from `help.ts`.
UNKNOWN_TOPIC errors only occur for genuinely nonexistent topics.

**Startup call cost estimate:** Post-redesign startup chain is
`session/start` → `help('start')` → `profile/load` → `dequeue`.
That's 4 tool calls. `help('start')` is self-contained — no chaining
required. An agent that wants the full guide can optionally call
`help('guide')` (1 additional call). Total: 4-5 calls, not 8+.

## 11. Implementation Dependencies

```text
This spec (10-495)
  → 10-494: Startup hint chain redesign (help('start') content)
  → 10-496: Guide content audit (apply extraction rules from §4.3)
  → 10-497: Tutorial mode (§9 integration)
  → 10-500: Dequeue timeout-zero response
  → 10-501: Profile/load response format
  → 10-502: Help topics to markdown (§10 Phase 2)
  → 10-503: Reaction same-priority replacement bug
  → 10-504: Array-based reaction API
```
