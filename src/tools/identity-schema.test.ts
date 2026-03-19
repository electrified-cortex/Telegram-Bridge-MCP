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
  // Basic Zod-level validation
  // -----------------------------------------------------------------------
  describe("Zod validation", () => {
    it("accepts a valid [sid, pin] pair", () => {
      expect(IDENTITY_SCHEMA.safeParse([1, 815519]).success).toBe(true);
    });

    it("accepts undefined (optional)", () => {
      expect(IDENTITY_SCHEMA.safeParse(undefined).success).toBe(true);
    });

    it("rejects non-integer numbers", () => {
      expect(IDENTITY_SCHEMA.safeParse([1.5, 2]).success).toBe(false);
    });

    it("rejects non-number elements", () => {
      expect(IDENTITY_SCHEMA.safeParse(["a", "b"]).success).toBe(false);
    });

    it("rejects a single number (too few elements for auth)", () => {
      // Length enforcement is at runtime in requireAuth, but a single
      // element is still a valid array to Zod — this test documents that
      // the schema itself doesn't constrain length.
      expect(IDENTITY_SCHEMA.safeParse([1]).success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // JSON Schema output — the critical regression guard.
  //
  // OpenAI (and GitHub Copilot) validators require `items` to be an object
  // or boolean, never an array.  `z.tuple()` emits `prefixItems` (draft
  // 2020-12) or `items` as an array (OpenAPI target), both of which are
  // rejected.  `z.array()` emits `items` as a single schema object.
  // -----------------------------------------------------------------------
  describe("JSON Schema output (OpenAI compatibility)", () => {
    it("produces items as a schema object, not an array", () => {
      const schema = identityJsonSchema(IDENTITY_SCHEMA);
      expect(schema).toHaveProperty("type", "array");
      expect(schema).toHaveProperty("items");
      // `items` must be an object (single schema), not an array
      expect(schema.items).toBeTypeOf("object");
      expect(Array.isArray(schema.items)).toBe(false);
    });

    it("does not emit prefixItems", () => {
      const schema = identityJsonSchema(IDENTITY_SCHEMA);
      expect(schema).not.toHaveProperty("prefixItems");
    });

    it("inner items schema declares integer type", () => {
      const schema = identityJsonSchema(IDENTITY_SCHEMA);
      const items = schema.items as Record<string, unknown>;
      expect(items).toHaveProperty("type", "integer");
    });

    it("z.tuple() would produce an invalid schema (regression proof)", () => {
      // This test documents WHY we use z.array() — z.tuple() emits
      // prefixItems or array-form items, both rejected by OpenAI.
      const tupleSchema = z.tuple([z.number().int(), z.number().int()]).optional();
      const schema = identityJsonSchema(tupleSchema);

      // tuple emits prefixItems (draft 2020-12) which is an array
      expect(schema).toHaveProperty("prefixItems");
      expect(Array.isArray(schema.prefixItems)).toBe(true);
    });

    it("identity property is not marked required (optional schema)", () => {
      const full = z.toJSONSchema(z.object({ identity: IDENTITY_SCHEMA }));
      const required = (full as Record<string, unknown>).required as string[] | undefined;
      // optional() means identity should NOT appear in required
      expect(required ?? []).not.toContain("identity");
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
      expect(props.identity).toHaveProperty("type", "array");
      expect(Array.isArray(props.identity.items)).toBe(false);
      expect(props.identity).not.toHaveProperty("prefixItems");
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
