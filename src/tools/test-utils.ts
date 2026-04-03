import { vi } from "vitest";
import { z, type ZodRawShape } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TelegramError } from "../telegram.js";

// ---------------------------------------------------------------------------
// Minimal McpServer mock that captures tool registrations
// ---------------------------------------------------------------------------

export type ToolHandler = (args: Record<string, unknown>, extra?: Record<string, unknown>) => Promise<unknown>;

export interface MockServer {
  registerTool: ReturnType<typeof vi.fn>;
  resource: ReturnType<typeof vi.fn>;
  getHandler(name: string): ToolHandler;
}

export function createMockServer(): MockServer & McpServer {
  const handlers: Record<string, ToolHandler> = {};
  const _defaultExtra = { signal: new AbortController().signal };
  const registerTool = vi.fn(
    (_name: string, config: { description?: string; inputSchema?: ZodRawShape }, handler: ToolHandler) => {
      const schema = config.inputSchema ?? {};
      handlers[_name] = async (args, extra) => {
        let parsed: Record<string, unknown>;
        try {
          parsed = z.object(schema).parse(args);
        } catch (err) {
          // Map ZodError for missing/invalid `token` to a SID_REQUIRED response
          // so identity-gate tests remain meaningful after the token redesign.
          if (err instanceof z.ZodError) {
            const tokenIssue = err.issues.find(i => i.path[0] === "token");
            if (tokenIssue) {
              return {
                isError: true,
                content: [{ type: "text", text: JSON.stringify({
                  code: "SID_REQUIRED",
                  message: "token is required. Pass the token returned by session_start.",
                }) }],
              };
            }
          }
          throw err;
        }
        return handler(parsed, extra ?? _defaultExtra);
      };
    }
  );
  const resource = vi.fn();
  return {
    registerTool,
    resource,
    getHandler(name: string): ToolHandler {
      const h = handlers[name] as ToolHandler | undefined;
      if (!h) throw new Error(`No tool registered with name "${name}"`);
      return h;
    },
    // Only implements the McpServer subset that tools call (registerTool, resource).
    // Full McpServer has additional members never invoked by tools during testing.
  } as unknown as MockServer & McpServer;
}

// ---------------------------------------------------------------------------
// Helpers for asserting MCP tool results
// ---------------------------------------------------------------------------

export function parseResult<T = Record<string, unknown>>(
  result: unknown,
  _hint?: T,
): T {
  const r = result as { content: { text: string }[] };
  return JSON.parse(r.content[0].text) as T;
}

export function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

export function errorCode(result: unknown): string {
  return parseResult<TelegramError>(result).code;
}
