/**
 * Regression test: every registered tool's JSON Schema must be
 * compatible with OpenAI's strict JSON Schema validator.
 *
 * OpenAI rejects schemas where `items` is an array (tuple-style)
 * or where `prefixItems` appears. This test walks every tool's
 * input schema after Zod→JSON Schema conversion and asserts
 * no property anywhere violates these rules.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { z, type ZodType } from "zod";

// ---------------------------------------------------------------------------
// Capture tool registrations via a mock McpServer
// ---------------------------------------------------------------------------

interface CapturedTool {
  name: string;
  inputSchema: ZodType;
}

const captured: CapturedTool[] = [];

vi.mock("./telegram.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./telegram.js")>();
  return {
    ...orig,
    getApi: () => ({}),
    resolveChat: () => 42,
    sendServiceMessage: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./session-manager.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./session-manager.js")>();
  return { ...orig, getActiveSession: () => 0 };
});

vi.mock("./session-context.js", () => ({
  runInSessionContext: (_sid: number, fn: () => unknown) => fn(),
}));

// The test imports createServer which reads docs files — mock fs
vi.mock("fs", async (importOriginal) => {
  const orig = await importOriginal<typeof import("fs")>();
  return {
    ...orig,
    readFileSync: (path: string, ...args: unknown[]) => {
      if (typeof path === "string" && path.endsWith(".md")) return "# mock";
      return orig.readFileSync(path, ...args as [BufferEncoding]);
    },
  };
});

// ---------------------------------------------------------------------------
// Recursive schema walker
// ---------------------------------------------------------------------------

interface Violation {
  path: string;
  kind: "items_is_array" | "prefixItems_present";
}

function walkSchema(
  schema: Record<string, unknown>,
  path: string,
  violations: Violation[],
): void {
  if (typeof schema !== "object" || schema === null) return;

  // Check: `items` must not be an array
  if ("items" in schema) {
    if (Array.isArray(schema.items)) {
      violations.push({ path: `${path}.items`, kind: "items_is_array" });
    } else if (typeof schema.items === "object" && schema.items !== null) {
      walkSchema(schema.items as Record<string, unknown>, `${path}.items`, violations);
    }
  }

  // Check: `prefixItems` must not exist
  if ("prefixItems" in schema) {
    violations.push({ path: `${path}.prefixItems`, kind: "prefixItems_present" });
  }

  // Walk `properties`
  if ("properties" in schema && typeof schema.properties === "object" && schema.properties !== null) {
    for (const [key, value] of Object.entries(schema.properties as Record<string, unknown>)) {
      if (typeof value === "object" && value !== null) {
        walkSchema(value as Record<string, unknown>, `${path}.properties.${key}`, violations);
      }
    }
  }

  // Walk `additionalProperties`
  if (
    "additionalProperties" in schema &&
    typeof schema.additionalProperties === "object" &&
    schema.additionalProperties !== null
  ) {
    walkSchema(
      schema.additionalProperties as Record<string, unknown>,
      `${path}.additionalProperties`,
      violations,
    );
  }

  // Walk `anyOf` / `oneOf` / `allOf`
  for (const combiner of ["anyOf", "oneOf", "allOf"] as const) {
    if (combiner in schema && Array.isArray(schema[combiner])) {
      (schema[combiner] as Record<string, unknown>[]).forEach((sub, i) => {
        walkSchema(sub, `${path}.${combiner}[${i}]`, violations);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenAI JSON Schema compatibility — all tools", () => {
  beforeAll(() => {
    captured.length = 0;
  });

  // Import createServer which registers all tools on a real McpServer.
  // We then access the private _registeredTools map.
  it("collects all registered tools", async () => {
    const { createServer } = await import("./server.js");
    const server = createServer();

    // Access internal tools map (runtime-accessible, not truly private)
    const registeredTools = (server as unknown as Record<string, unknown>)
      ._registeredTools as Record<string, { inputSchema?: unknown }>;

    const toolNames = Object.keys(registeredTools);
    // Sanity: we expect 37+ tools
    expect(toolNames.length).toBeGreaterThanOrEqual(37);

    for (const [name, tool] of Object.entries(registeredTools)) {
      if (tool.inputSchema) {
        captured.push({
          name,
          inputSchema: tool.inputSchema as ZodType,
        });
      }
    }
  });

  it.each(["draft-2020-12", "openapi-3.0"] as const)(
    "no tool schema contains prefixItems or array-form items (target: %s)",
    (target) => {
      expect(captured.length).toBeGreaterThanOrEqual(37);

      const allViolations: Array<{ tool: string } & Violation> = [];

      for (const { name, inputSchema } of captured) {
        const jsonSchema = z.toJSONSchema(inputSchema, { target }) as Record<string, unknown>;

        const violations: Violation[] = [];
        walkSchema(jsonSchema, name, violations);

        for (const v of violations) {
          allViolations.push({ tool: name, ...v });
        }
      }

      if (allViolations.length > 0) {
        const report = allViolations
          .map((v) => `  ${v.tool}: ${v.kind} at ${v.path}`)
          .join("\n");
        expect.fail(
          `OpenAI-incompatible JSON Schema (${target}) in ${allViolations.length} tool(s):\n${report}`,
        );
      }
    },
  );

  it.each(["draft-2020-12", "openapi-3.0"] as const)(
    "items is always an object or boolean when present (target: %s)",
    (target) => {
      for (const { name, inputSchema } of captured) {
        const jsonSchema = z.toJSONSchema(inputSchema, { target }) as Record<string, unknown>;

        const check = (node: Record<string, unknown>, path: string): void => {
          if ("items" in node) {
            const itemsType = typeof node.items;
            expect(
              itemsType === "object" || itemsType === "boolean",
              `${name}: ${path}.items should be object or boolean, got ${itemsType}`,
            ).toBe(true);
            expect(
              !Array.isArray(node.items),
              `${name}: ${path}.items must not be an array`,
            ).toBe(true);
          }
          if ("properties" in node && typeof node.properties === "object" && node.properties !== null) {
            for (const [k, v] of Object.entries(node.properties as Record<string, unknown>)) {
              if (typeof v === "object" && v !== null) {
                check(v as Record<string, unknown>, `${path}.properties.${k}`);
              }
            }
          }
        };

        check(jsonSchema, name);
      }
    },
  );
});
