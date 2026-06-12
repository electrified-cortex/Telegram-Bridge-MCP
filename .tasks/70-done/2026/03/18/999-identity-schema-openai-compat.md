# Identity schema — OpenAI JSON Schema compatibility

**Type:** Bug fix
**Priority:** 300 (Normal — not blocking, workaround exists)
**Status:** Queued

## Problem

OpenAI models reject tool calls when the JSON Schema for a parameter's `items` is an **array** instead of an **object** or **boolean**:

```text
Invalid schema for function 'mcp_telegram_append_text':
[{'type': 'integer', ...}, {'type': 'integer', ...}] is not of type 'object', 'boolean'
```

This affects **every tool** that includes the `identity` parameter (all 37+ tools).
Anthropic models are unaffected — their validator accepts tuple-style `items`.

### Root cause

Zod v4's `z.tuple()` serializes to `prefixItems` (draft 2020-12) or `items` as an array (OpenAPI target).
The MCP SDK uses `z.toJSONSchema()` for Zod v4, which faithfully emits the tuple schema.
OpenAI's validator expects `items` to be a single schema object, not an array of schemas.

### Prior fix (commit `55c9c11`)

Changed `IDENTITY_SCHEMA` from `z.tuple([z.number().int(), z.number().int()])` to `z.array(z.number().int())`.
Source code is correct. The error may persist if:

1. `dist/` was not rebuilt after the source fix (`pnpm build`)
2. VS Code is running a cached/stale MCP server process
3. VS Code needs a full restart (not just reload) to pick up the new schema

## Task

Investigate why the error persists after the source fix. Ensure end-to-end validation so this class of bug is caught before it reaches production.

## Code path

- `src/tools/identity-schema.ts` — the shared Zod schema constant
- `src/tools/identity-schema.test.ts` — existing tests (12 tests, validates JSON Schema output)
- `dist/tools/identity-schema.js` — compiled output (must match source)
- MCP SDK compat layer: `node_modules/@modelcontextprotocol/sdk/.../zod-json-schema-compat.js`

## Acceptance criteria

- [ ] `dist/` is confirmed rebuilt and matches source (`z.array`, no `z.tuple`)
- [ ] VS Code MCP server restart confirmed (kill process, not just reload)
- [ ] A **regression test** iterates every registered tool's input schema (all 37+ tools), recursively walks the JSON Schema tree, and asserts:
  - No property anywhere contains `prefixItems`
  - `items` is always an object or boolean, never an array
  - This catches any future `z.tuple()` introduction in any tool
- [ ] The test uses the actual tool definitions from `server.ts` (or the tool registration list), not just `IDENTITY_SCHEMA` in isolation
- [ ] Verification passes against both `draft-2020-12` and `openapi` targets
- [ ] Document the rebuild + restart requirement in the task completion notes
- [ ] All tests pass
- [ ] Build clean, lint clean
