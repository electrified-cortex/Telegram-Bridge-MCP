---
type: idea
status: icebox
filed-by: Curator
date: 2026-05-05
---

# Expose all MCP tools as RESTful HTTP

## Operator framing (2026-05-05)

> Source: operator voice, 2026-05-05 (distilled). Considering exposing everything the MCP offers as a RESTful HTTP surface; framed as an interim, icebox-tier idea.

Generic REST surface mirroring the MCP tool catalog. Each tool gets a corresponding `POST /<tool-name>` route that takes the tool's args as JSON body and returns the tool result with no MCP envelope. Auth: same token-from-body / token-from-query pattern as 10-0873.

## Why icebox

10-0873 ships the dedicated `/dequeue` for the immediate watcher need. Generalizing to the full tool catalog is broader scope:

- Consistent body/query auth pattern across all tools.
- Response-shape normalization (some MCP tools return content arrays, others structured objects).
- Tool registry → REST route auto-generation, vs. hand-written per tool.
- Tests for parity against the MCP-tool path.

Not blocking. Re-surface when:

- A second consumer wants HTTP access to a TMCP tool (after `/dequeue`).
- The pattern from 10-0873 has settled and we can templatize it.

## Related

- 10-0873 (dedicated `/dequeue` — first instance of this pattern).
- 10-0872 (watcher consumes 10-0873).
