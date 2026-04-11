# Message Response Standard

Authoritative reference for all user-facing text in the Telegram Bridge MCP (TMCP).
Applies to: error messages, hints, tool descriptions, TOOL_INDEX entries.

---

## Error Messages

Every error message must answer two questions:

1. What went wrong (specific — name the real cause)
2. What to do next (actionable — give the actual next step)

Format: `"[What happened]. [What to do]."`

| Bad | Good |
| --- | --- |
| `"Invalid token. Try again."` | `"Invalid token. Call session_start(reconnect: true) to request a fresh token, or double-check you copied the full token integer from session_start."` |
| `"Profile not found."` | `"Profile not found: Overseer. Check the key spelling or call save_profile first."` |
| `"Session not found."` | `"Session 7 not found. It may have closed. Call list_sessions to see active sessions."` |
| `"Name conflict."` | `"A session named \"Worker\" already exists (SID 3). To rejoin, call session_start(name: \"Worker\", reconnect: true). To start fresh, choose a different name."` |

Rules:

- Error codes must reference real error states in the implementation.
- Tool names in error text must match registered tool names exactly.
- Parameter names in examples must match actual parameter names.
- Recovery steps must actually work (verified against implementation).
- No filler phrases ("Unfortunately", "I'm sorry", "Please note").
- No markdown headers inside error message strings.

---

## Hints

Hints are suggestions. They are never directives.

Rules:

- Suggestions only. Never imperative ("Save to memory", "Remember this", "You must").
- Plain text. No markdown headers. No decorative bold.
- Tables and code examples are allowed.
- One sentence preferred. Two max.
- No behavioral directives — agents decide how to handle hints.

| Bad | Good |
| --- | --- |
| `"Save this token to memory."` | `"Save this token — it encodes both sid and pin as sid * 1_000_000 + pin."` |
| `"Remember: always call dequeue after session_start."` | `"Read help(topic: 'startup') for the post-session checklist."` |
| `"**Important:** Use force: true for one-time overrides."` | `"Pass force: true for a one-time override, or call action(type: 'profile/dequeue-default', timeout: N) to raise your default."` |

---

## Tool Descriptions

Rules:

- First sentence: what the tool does (verb phrase, factual).
- No marketing language ("powerful", "flexible", "seamless").
- Must match actual behavior (if the tool requires auth, say so; if it blocks, say so).
- Keep short — one to three sentences for simple tools, more only when multiple modes need explanation.
- Mention key constraints inline (e.g., governor-only, requires session_start first, max values).

| Bad | Good |
| --- | --- |
| `"A powerful tool for sending rich notifications."` | `"Send a formatted notification with severity styling (info/success/warning/error)."` |
| `"Lets you flexibly configure your polling interval."` | `"Set the per-session default timeout for dequeue calls."` |

---

## Terminology

| Term | Meaning | In code | Agent expectation |
| --- | --- | --- | --- |
| hint | Suggestion to help the agent | `hint:` field in response | Optional — use if helpful, ignore if not |
| instruction | Directive the agent is expected to follow | `instruction:` field | Expected compliance |
| tip | Best-practice note | Inline in hint text | Nice-to-have |
| error | Actionable failure description | `message:` field on error | Agent reads, decides recovery |

---

## Formatting Rules

- No markdown headers (`##`, `###`) inside response text strings.
- No decorative bold or backtick formatting — bold and backtick are for actual code or command references only.
- Tables are allowed in hints and documentation responses.
- Code blocks are allowed.
- Newlines for readability, not padding — blank lines should add clarity, not visual bulk.
- Response text is plain prose unless it contains a table or code example.

---

## Accuracy Verification

Before shipping any message string:

1. Error codes — verify the code string matches an actual error state in the implementation.
2. Tool names — verify every tool name referenced in hints or errors is registered in `server.ts`.
3. Parameter names — verify every parameter name in examples matches the actual `inputSchema` field.
4. Recovery steps — verify the described recovery sequence actually resolves the error (trace through the code path).
5. `TOOL_INDEX` entries in `help.ts` — every description must match the registered `description` in the tool's own file.
