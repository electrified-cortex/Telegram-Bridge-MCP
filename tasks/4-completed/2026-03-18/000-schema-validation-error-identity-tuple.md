# Schema Validation Error — Identity Tuple JSON Schema Conversion

**Priority:** 1000 (Critical — blocks model switching)
**Status:** Draft
**Created:** 2026-03-18
**Assignee:** —
**Affected Models:** Claude (via GitHub Copilot), likely other LLM integrations

## Problem

When switching between LLM models in VS Code, the Copilot extension fails with:

```
Invalid schema for function 'mcp_telegram_append_text': 
[{'type': 'integer', 'minimum': -9007199254740991, 'maximum': 9007199254740991}, 
 {'type': 'integer', 'minimum': -9007199254740991, 'maximum': 9007199254740991}] 
is not of type 'object', 'boolean'.
```

This error occurs because the Zod `z.tuple([z.number().int(), z.number().int()])` schema is being converted to invalid JSON Schema format by the MCP SDK's Zod-to-JSON-Schema converter.

**Affected tools:** All 21 Telegram MCP tools that use the `identity` parameter:
- `mcp_telegram_append_text`
- `mcp_telegram_ask`
- `mcp_telegram_choose`
- `mcp_telegram_confirm`
- `mcp_telegram_dequeue_update`
- `mcp_telegram_delete_message`
- `mcp_telegram_download_file`
- `mcp_telegram_get_chat`
- `mcp_telegram_get_debug_log`
- `mcp_telegram_get_message`
- `mcp_telegram_notify`
- `mcp_telegram_pin_message`
- `mcp_telegram_send_choice`
- `mcp_telegram_set_reaction`
- And 6 others

## Root Cause

The Zod schema for `identity`:

```typescript
identity: z
  .tuple([z.number().int(), z.number().int()])
  .optional()
  .describe("Identity tuple [sid, pin] from session_start...")
```

When converted to JSON Schema, produces an invalid structure that GitHub Copilot's schema validator rejects. The issue is that the tuple is serialized as an array of object definitions instead of using proper JSON Schema `prefixItems` format.

## Solution

Replace all Zod tuple schemas for `identity` with proper JSON Schema definitions. Create a reusable constant:

**File:** `src/tools/identity-schema.ts` (already created)

This defines `IDENTITY_SCHEMA` with proper JSON Schema structure:
```typescript
{
  type: "array",
  prefixItems: [
    { type: "integer", exclusiveMinimum: 0, maximum: 9007199254740991 },
    { type: "integer", minimum: -9007199254740991, maximum: 9007199254740991 }
  ],
  minItems: 2,
  maxItems: 2,
  description: "Identity tuple [sid, pin] from session_start..."
}
```

Replace all 21 instances of the Zod tuple definition with direct references to `IDENTITY_SCHEMA`.

## Files to Update

Replace `identity: z.tuple([z.number().int(), z.number().int()]).optional().describe(...)` with `identity: IDENTITY_SCHEMA` in:

1. `src/tools/append_text.ts` (line 30)
2. `src/tools/ask.ts` (line 47)
3. `src/tools/answer_callback_query.ts` (line 37)
4. `src/tools/cancel_animation.ts` (line 27)
5. `src/tools/choose.ts` (line 79)
6. `src/tools/close_session.ts` (line 22)
7. `src/tools/confirm.ts` (line 79)
8. `src/tools/delete_message.ts` (line 17)
9. `src/tools/dequeue_update.ts` (line 62)
10. `src/tools/download_file.ts` (line 52)
11. `src/tools/dump_session_record.ts` (line 30)
12. `src/tools/edit_message.ts` (line 57)
13. `src/tools/edit_message_text.ts` (line 43)
14. `src/tools/get_chat.ts` (line 25)
15. `src/tools/get_debug_log.ts` (line 31)
16. `src/tools/get_message.ts` (line 28)
17. `src/tools/notify.ts` (line 51)
18. `src/tools/pin_message.ts` (line 32)
19. `src/tools/rename_session.ts` (line 18)
20. `src/tools/route_message.ts` (line 21)
21. `src/tools/send_choice.ts` (line 77)
22. `src/tools/set_reaction.ts` (need to find exact line)

**Optional updates** for consistency (not causing validation errors):
- `src/tools/send_chat_action.ts` (line 32) — has same pattern

## Testing

After replacing all schemas:
1. Run `pnpm build` to verify TypeScript compilation
2. Test in VS Code by switching between Claude and another model
3. Verify tools are callable from both models without schema validation errors
4. Run full test suite: `pnpm test`

## Notes

- This is a schema serialization issue, not a logic bug
- The fix maintains the same functional behavior — `identity` remains optional and accepts `[sid, pin]` tuples
- JSON Schema `prefixItems` is the correct way to define fixed-length typed arrays; Zod's tuple conversion has a known issue with MCP's schema validator
- The `sid` parameter is auto-injected by the server middleware, so agents rarely need to manually pass `identity`
