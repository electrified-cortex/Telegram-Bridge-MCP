# Telegram Bridge MCP — Feature Highlights

Internal reference. Covers the system's key design decisions and capabilities.

---

## 1. Token Compression Tiers

The bridge ships a four-tier compression model for all text produced by agents. Tiers are surface-mapped, not left to discretion.

| Tier | Surface | Style |
| --- | --- | --- |
| **None** | Audio messages, spec files, code blocks | Full natural language |
| **Lite** | Operator-facing text (Telegram messages) | Drop filler and hedging; keep articles |
| **Full** | Balanced prose documents | Drop articles; fragments acceptable |
| **Ultra** | Agent-to-agent DMs, CLAUDE.md, skill files, reminders | Telegraphic; abbreviate; arrows (X → Y) |

Ultra is the densest tier: no articles, no pleasantries, no hedging. Technical terms remain exact; paths and URLs are verbatim. Pattern: `[thing] [action] [reason]. [next step].`

**Behavioral nudge system** (v7.1.0): the server tracks button awareness per session. On the first actionable question sent as plain text (no buttons), the server fires a `behavior_nudge_question_hint` service message. After 10+ such questions it escalates to `behavior_nudge_question_escalation`. Nudges suppress permanently once the agent uses any button form or consults button help. This nudges agents toward lower-token interaction patterns without requiring operator intervention.

**Compact response format**: pass `response_format: "compact"` to `dequeue`, `send`, `ask`, `choose`, `confirm`, or `send_new_checklist` to suppress always-inferrable fields (`empty: true`, `timed_out: false`, `split: true`, etc.). Estimated savings: ~445 tokens per session. `timed_out: true` is always emitted even in compact mode so timeout detection remains unambiguous. Opt-in per call; no global switch.

---

## 2. Lean API Footprint

The entire bridge surface is exposed through four registered MCP tools:

| Tool | Purpose |
| --- | --- |
| `send` | All outbound messaging — text, voice/TTS, file, notification, question, checklist, progress, animation |
| `dequeue` | All inbound — messages, voice (pre-transcribed), commands, reactions, callbacks, service events |
| `action` | All stateful operations — session lifecycle, profile management, routing, shutdown, message edits, reactions |
| `help` | API discovery and inline documentation |

Beneath these four tools, the `action` dispatcher exposes a large set of typed operation paths (session/start, profile/load, message/route, checklist/update, shutdown/warn, etc.). The `send` tool routes on a `type` discriminator. Net schema overhead on the context window is modest — the entire tool schema injects roughly 6,600 tokens at session start, amortized across all turns.

The bridge requires a single Telegram Bot API token regardless of how many agent sessions are active. All sessions share one bot, one chat, and one long-poll connection. Running two MCP instances on the same token is explicitly unsupported — multi-agent capability is provided by the session layer, not by running multiple processes.

---

## 3. Multi-Session Architecture

Multiple agent sessions connect to a single bridge instance over HTTP transport. Each session receives an integer SID (1, 2, 3…) and an opaque suffix that together form its authentication token. The SID is public and appears in timeline metadata; the suffix is private to each agent's context window and cannot be forged by another session.

**Governor routing**: when two or more sessions are active, the lowest-SID session becomes the governor. The governor receives all ambiguous operator messages (those with no reply context) and decides whether to handle them or route them to a worker session via `action(type: "message/route")`. Targeted messages — replies, button callbacks, reactions — always go directly to the owning session and bypass the governor. If the governor closes, the next-lowest-SID session is auto-promoted.

**Color-coded identities**: each session is assigned a color square emoji from a six-color palette (🟦 🟩 🟨 🟧 🟥 🟪). In multi-session mode, the color prefix appears before the bot header on every outbound message, giving the operator instant visual attribution. Sessions can request a specific color at `session/start` or request a color change atomically with a rename via `session/rename`.

**Operator approval flow**: new sessions are held at a `/approve` gate. The operator sees the session's name and a delegation toggle. All permission changes — DM access, routing mode, governor designation — require operator confirmation via `confirm` prompts. No session can grant itself elevated permissions.

**Direct messages**: agents communicate privately via `send(type: "dm")`. DMs are invisible to the operator; the `sid` field is server-injected and cannot be forged. DM text is not operator truth — agents must never execute destructive actions from a DM alone.

---

## 4. Voice-First UX

The bridge is designed for an operator who communicates primarily by voice from a mobile device.

**Inbound**: voice messages are transcribed automatically via local Whisper before they reach `dequeue`. The bridge manages the transcription lifecycle visually — `✍` reaction while transcribing, `😴` if queued, `🫡` when delivered. The agent receives the result as `{ type: "voice", text: "..." }` — no special handling required.

**Outbound**: `send(type: "text", audio: "...")` synthesizes the text via TTS (Kokoro, OpenAI, or the bundled ONNX fallback) and delivers it as a voice note. Voice resolution uses a four-level priority chain: explicit `voice` parameter → session override → global default → provider default.

**Hybrid messages**: passing both `text` and `audio` to `send` produces a voice note with a text caption in one message — useful when the operator may be away from their phone and unable to play audio. Audio content should be written as natural spoken language; Markdown is stripped before synthesis.

**Async TTS** (v7.2.0): TTS sends are async by default — the tool returns `message_id_pending` immediately and delivers the result via a `send_callback` `dequeue` event, avoiding blocking the agent during synthesis. Pass `async: false` to opt into synchronous behavior.

---

## 5. Self-Documenting Help System

The `help` tool provides inline documentation without requiring agents to consult external files.

```text
help()                    — tool index listing all registered tools
help(topic: 'index')      — categorized skill navigation menu
help(topic: 'guide')      — full communication and behavior guide
help(topic: 'compression')— compression tier surface map
help(topic: 'startup')    — post-session-start checklist
help(topic: '<tool>')     — per-tool reference (dequeue, send, checklist, etc.)
```

Topic navigation uses breadcrumbs — each topic lists sub-topics and related entry points. Agents can bootstrap entirely from `help()` at session start; no external skill files are required. Topics are stored as Markdown files under `docs/help/` and served as compressed agent-readable reference at runtime.

---

## 6. Profile System

Profiles are JSON files loaded at session start via `action(type: "profile/load", key: "<name>")`. Each profile can specify:

- **TTS voice and speed** — per-agent voice identity
- **Nametag emoji** — prefix on outbound message author labels
- **Animation presets** — named arrays of frame strings for status animations
- **Default animation** — ambient cycling animation for indeterminate waits
- **Reminders** — recurring or startup-fired reminder definitions with delay and trigger settings
- **Color hint** — preferred session color (applied retroactively if available)

Profiles live under `data/profiles/` (outside version control by default) or under a committed `profiles/` directory at repo root for shareable non-secret defaults. The active session's voice and animation state can be persisted back with `action(type: "profile/save")`. Reminder IDs use content hashing (SHA-256 truncated to 16 hex chars) so loading the same profile twice is idempotent — same `text + recurring` combination always produces the same reminder ID.

The bridge ships profiles for named agent roles (Worker, Curator, Overseer) with pre-configured colors and reminders.

---

## 7. Session Lifecycle

**Startup**: `action(type: "session/start")` is always the first call. It returns `sid`, `sessions_active`, `discarded` count, and a `fellow_sessions` list. If `sessions_active > 1`, the session should set a topic immediately. An optional profile load follows, then a drain-then-block dequeue loop.

**Reconnect**: on transport disconnect, sessions can be reclaimed within a timeout window using `action(type: "session/reconnect", name: "...")`. After reconnect, call `action(type: "message/history", count: 20)` to catch up on missed messages.

**Clean shutdown** (single session): call `action(type: "shutdown")` — flushes queues, rolls the session log, notifies connected agents, exits the process.

**Governor-coordinated shutdown** (multi-session): governor calls `action(type: "shutdown/warn")` to DM all workers; workers finish their current atomic step and call `action(type: "session/close")`; governor watches for `session_closed` events; once all workers have closed (or a grace period expires), governor calls `action(type: "shutdown")`.

**Session dump and archive**: `dump_session_record()` sends the rolling timeline (up to 1000 events) as a JSON file to the Telegram chat. The `/session` built-in command provides an operator-facing panel for manual dumps and auto-dump configuration. Session logs are written to disk via `data/logs/` when logging is enabled; `action(type: "log/roll")` archives the current log and opens a new one.

**MCP restart recovery**: on restart, all sessions are invalidated (in-memory only). Agents that receive a `shutdown` service event stop their dequeue loop, wait for the host to relaunch, then reconnect via `action(type: "session/start")`. A `forced_stop` recovery event is injected when the previous session ended uncleanly, prompting corrective action before resuming.

---

## 8. Visual Tools

The bridge provides three classes of persistent in-chat visual primitives, each managing its own message lifecycle.

**Progress bars** (`send(type: "progress")` + `action(type: "progress/update")`): rendered as emoji blocks (`▓▓▓▓▓░░░░░ 50%`). Auto-pins on create; auto-unpins when `percent` reaches 100. Multiple concurrent bars are supported — each tracked by its own `message_id`. Parameters: `title`, `percent` (0–100), `subtext` (optional italic detail line), `width` (default 10, max 40 chars).

**Checklists** (`send(type: "checklist")` + `action(type: "checklist/update")`): live task list with per-step status indicators — `pending`, `running`, `done`, `failed`, `skipped`. Auto-pins on create; auto-unpins when all steps reach a terminal status. Completion reply reflects actual outcome: `✅ Complete`, `🟡 Incomplete N/M done`, or `🔴 Failed — N/M passed, F failed`.

**Animations** (`send(type: "animation")` + `action(type: "animation/cancel")`): ephemeral cycling placeholder visible while the agent works. Accepts an array of frame strings that cycle during the wait. Cancelling with `text` edits the placeholder into a permanent log message; cancelling without text deletes it. Only one animation active per session at a time. Built-in named presets: `working`, `thinking`, `recovering`, `compacting`.

**Temporary reactions**: `action(type: "react", temporary: true)` sets a reaction that auto-reverts on the next outbound action or after a timeout — used for "I'm reading this" acknowledgements without permanent clutter.

---

## 9. Spec-Driven Development

Every significant feature area has a companion `.spec.md` file defining purpose, audience, and content rules before implementation begins. Spec files live alongside the content they govern:

```text
docs/help/compression.spec.md   — compression tier rules
docs/help/dequeue.spec.md       — dequeue loop docs
docs/help/guide.spec.md         — agent guide content rules
docs/help/animation.spec.md     — animation reference rules
docs/help/checklist.spec.md     — checklist reference rules
docs/help/start.spec.md         — session start reference
docs/help/startup.spec.md       — post-start checklist rules
src/tools/session_start.spec.md — session start tool behavior
tasks/.engine/claim-task/spec.md — task claim script behavior
```

Spec files establish: what a topic must cover, who the audience is, and what compression tier applies. They are intentionally minimal — three to five lines. Implementation must conform to the spec; spec changes require explicit review. This separates "what does this doc do" from "what does this doc say," preventing content drift and making review surface clear.

---

## 10. SHA-256 Audit Stamps

Content hashing is used in two places to provide idempotency and integrity guarantees.

**Reminder IDs**: reminder identifiers are derived from `SHA-256(text + recurring)`, truncated to 16 hex characters. The same reminder definition always produces the same ID across profile loads, preventing duplicate reminder registration when profiles are loaded multiple times in a session.

**Hook allowlist stamps**: the Worker pre-tool-use hook (`pretooluse-permissions.ps1`) gates script execution against a curated allowlist using exact SHA-256 content hashes. Any script modification — including whitespace or comment changes — invalidates the hash and blocks execution until the Curator restamps the allowlist. This is a governance control: Workers cannot silently run modified scripts. The allowlist lives in `permissions-scripts.ps1` alongside the hook. (Reform of this mechanism is tracked in task 10-737.)

Both uses share the same principle: exact content identity is checkable offline, without any trust in the file path or transport.
