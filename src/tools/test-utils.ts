import { vi } from "vitest";
import { z, type ZodRawShape } from "zod";
import type { TelegramError } from "../telegram.js";

// ---------------------------------------------------------------------------
// Minimal McpServer mock that captures tool registrations
// ---------------------------------------------------------------------------

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface MockServer {
  tool: ReturnType<typeof vi.fn>;
  resource: ReturnType<typeof vi.fn>;
  getHandler(name: string): ToolHandler;
}

export function createMockServer(): MockServer {
  const handlers: Record<string, ToolHandler> = {};
  const tool = vi.fn(
    (_name: string, _desc: string, schema: ZodRawShape, handler: ToolHandler) => {
      handlers[_name] = (args) => handler(z.object(schema).parse(args));
    }
  );
  const resource = vi.fn();
  return {
    tool,
    resource,
    getHandler(name: string): ToolHandler {
      const h = handlers[name];
      if (!h) throw new Error(`No tool registered with name "${name}"`);
      return h;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers for asserting MCP tool results
// ---------------------------------------------------------------------------

export function parseResult(result: unknown): unknown {
  const r = result as { content: { text: string }[] };
  return JSON.parse(r.content[0].text);
}

export function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

export function errorCode(result: unknown): string {
  return (parseResult(result) as TelegramError).code;
}
