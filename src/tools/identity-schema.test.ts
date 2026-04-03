import { describe, it, expect } from "vitest";
import { z } from "zod";
import { IDENTITY_SCHEMA } from "./identity-schema.js";

// ---------------------------------------------------------------------------
// Replicate the MCP SDK's Zod v4 → JSON Schema conversion.
// The SDK calls `z.toJSONSchema()` for Zod v4 schemas (see
// node_modules/@modelcontextprotocol/sdk/.../zod-json-schema-compat.js).
// ---------------------------------------------------------------------------

/**
 * Converts a Zod object schema to JSON Schema the same way the MCP SDK does.
 * Returns just the `properties.identity` sub-schema for focused assertions.
 */
function identityJsonSchema(identityZod: z.ZodType) {
  const full = z.toJSONSchema(z.object({ identity: identityZod }));
  const props = (full as Record<string, unknown>).properties as Record<string, unknown>;
  return props.identity as Record<string, unknown>;
}

describe("IDENTITY_SCHEMA", () => {
  // -----------------------------------------------------------------------
  // Basic Zod-level validation — z.unknown() accepts anything at the Zod
  // layer.  Semantic validation happens inside requireAuth (session-gate.ts).
  // -----------------------------------------------------------------------
  describe("Zod validation", () => {
    it("accepts a valid [sid, pin] pair", () => {
      expect(IDENTITY_SCHEMA.safeParse([1, 815519]).success).toBe(true);
    });

    it("accepts undefined (optional)", () => {
      expect(IDENTITY_SCHEMA.safeParse(undefined).success).toBe(true);
    });

    it("accepts a string (schema-level pass — handler validates semantics)", () => {
      // z.unknown() intentionally allows strings so the MCP framework does not
      // reject the call before the handler can return an actionable error.
      expect(IDENTITY_SCHEMA.safeParse("[1, 815519]").success).toBe(true);
    });

    it("accepts a number (schema-level pass — handler validates semantics)", () => {
      expect(IDENTITY_SCHEMA.safeParse(42).success).toBe(true);
    });

    it("accepts an array with non-integer numbers (schema-level pass)", () => {
      // requireAuth enforces element types at runtime
      expect(IDENTITY_SCHEMA.safeParse([1.5, 2]).success).toBe(true);
    });

    it("accepts a single element array (schema-level pass)", () => {
      // Length enforcement is at runtime in requireAuth
      expect(IDENTITY_SCHEMA.safeParse([1]).success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // JSON Schema output — z.unknown() produces no type constraints, which is
  // intentional.  The description carries the contract; the handler enforces it.
  //
  // OpenAI (and GitHub Copilot) validators require `items` to be an object
  // or boolean, never an array.  z.unknown() emits no items at all, which
  // satisfies the OpenAI validator.
  // -----------------------------------------------------------------------
  describe("JSON Schema output (OpenAI compatibility)", () => {
    it("does not emit a type constraint (z.unknown emits no type)", () => {
      const schema = identityJsonSchema(IDENTITY_SCHEMA);
      // z.unknown() should NOT emit type: "array" — it emits no type constraint
      expect(schema).not.toHaveProperty("type", "array");
    });

    it("does not emit prefixItems", () => {
      const schema = identityJsonSchema(IDENTITY_SCHEMA);
      expect(schema).not.toHaveProperty("prefixItems");
    });

    it("does not emit items", () => {
      const schema = identityJsonSchema(IDENTITY_SCHEMA);
      expect(schema).not.toHaveProperty("items");
    });

    it("identity property is not marked required (optional schema)", () => {
      const full = z.toJSONSchema(z.object({ identity: IDENTITY_SCHEMA }));
      const required = (full as Record<string, unknown>).required as string[] | undefined;
      // optional() means identity should NOT appear in required
      expect(required ?? []).not.toContain("identity");
    });

    it("z.tuple() would produce an invalid schema (regression proof)", () => {
      // This test documents WHY we use z.unknown() — z.tuple() emits
      // prefixItems or array-form items, both rejected by OpenAI.
      const tupleSchema = z.tuple([z.number().int(), z.number().int()]).optional();
      const schema = identityJsonSchema(tupleSchema);

      // tuple emits prefixItems (draft 2020-12) which is an array
      expect(schema).toHaveProperty("prefixItems");
      expect(Array.isArray(schema.prefixItems)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Full tool-shaped schema — validate the shape a model actually receives.
  // -----------------------------------------------------------------------
  describe("realistic tool input schema", () => {
    it("produces a valid object schema when combined with other params", () => {
      const toolInput = z.object({
        text: z.string().describe("Message body"),
        timeout: z.number().int().optional(),
        identity: IDENTITY_SCHEMA,
      });

      const schema = z.toJSONSchema(toolInput) as Record<string, unknown>;
      expect(schema).toHaveProperty("type", "object");

      const props = schema.properties as Record<string, Record<string, unknown>>;
      expect(props.text).toHaveProperty("type", "string");
      // identity is z.unknown() — no type constraint or items emitted
      expect(props.identity).not.toHaveProperty("prefixItems");
      expect(Array.isArray((props.identity as Record<string, unknown>)?.items)).toBe(false);
    });

    it("all property schemas are objects or booleans (OpenAI rule)", () => {
      const toolInput = z.object({
        text: z.string(),
        identity: IDENTITY_SCHEMA,
      });

      const schema = z.toJSONSchema(toolInput) as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;

      for (const [key, value] of Object.entries(props)) {
        const t = typeof value;
        expect(
          t === "object" || t === "boolean",
          `property "${key}" should be object or boolean, got ${t}`,
        ).toBe(true);
        // If the property itself has sub-schemas (like items), they must also be objects
        if (t === "object" && value !== null) {
          const sub = value as Record<string, unknown>;
          if ("items" in sub) {
            const itemsType = typeof sub.items;
            expect(
              itemsType === "object" || itemsType === "boolean",
              `"${key}.items" should be object or boolean, got ${itemsType}`,
            ).toBe(true);
            expect(
              !Array.isArray(sub.items),
              `"${key}.items" must not be an array`,
            ).toBe(true);
          }
        }
      }
    });
  });
});
