import { describe, it, expect } from "vitest";
import { z } from "zod";
import { TOKEN_SCHEMA, decodeToken, consumeTokenStringHint, runInTokenHintContext } from "./identity-schema.js";

// ---------------------------------------------------------------------------
// Replicate the MCP SDK's Zod v4 → JSON Schema conversion.
// The SDK calls `z.toJSONSchema()` for Zod v4 schemas (see
// node_modules/@modelcontextprotocol/sdk/.../zod-json-schema-compat.js).
// ---------------------------------------------------------------------------

/**
 * Converts a Zod object schema to JSON Schema the same way the MCP SDK does.
 * Returns just the `properties.token` sub-schema for focused assertions.
 */
function tokenJsonSchema(tokenZod: z.ZodType) {
  const full = z.toJSONSchema(z.object({ token: tokenZod }));
  const props = (full as Record<string, unknown>).properties as Record<string, unknown>;
  return props.token as Record<string, unknown>;
}

describe("TOKEN_SCHEMA", () => {
  // -----------------------------------------------------------------------
  // Basic Zod-level validation
  // -----------------------------------------------------------------------
  describe("Zod validation", () => {
    it("accepts a valid token (sid=1, pin=815519)", () => {
      const token = 1 * 1_000_000 + 815519;
      expect(TOKEN_SCHEMA.safeParse(token).success).toBe(true);
    });

    it("accepts a valid multi-sid token (sid=5, pin=303780)", () => {
      const token = 5 * 1_000_000 + 303780;
      expect(TOKEN_SCHEMA.safeParse(token).success).toBe(true);
    });

    it("rejects zero (not positive)", () => {
      expect(TOKEN_SCHEMA.safeParse(0).success).toBe(false);
    });

    it("rejects negative numbers", () => {
      expect(TOKEN_SCHEMA.safeParse(-1000000).success).toBe(false);
    });

    it("rejects non-integer (float)", () => {
      expect(TOKEN_SCHEMA.safeParse(1.5).success).toBe(false);
    });

    it("accepts numeric string (coerces to integer)", () => {
      expect(TOKEN_SCHEMA.safeParse("1000000").success).toBe(true);
    });

    it("rejects non-numeric string", () => {
      expect(TOKEN_SCHEMA.safeParse("abc").success).toBe(false);
    });

    it("rejects mixed alphanumeric string", () => {
      expect(TOKEN_SCHEMA.safeParse("123abc").success).toBe(false);
    });

    it("rejects undefined (required)", () => {
      expect(TOKEN_SCHEMA.safeParse(undefined).success).toBe(false);
    });

    it("rejects null", () => {
      expect(TOKEN_SCHEMA.safeParse(null).success).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // JSON Schema output — the critical regression guard.
  //
  // OpenAI (and GitHub Copilot) validators require property schemas to be
  // objects or booleans, never arrays.
  // -----------------------------------------------------------------------
  describe("JSON Schema output (OpenAI compatibility)", () => {
    it("produces type: integer for the token property", () => {
      const schema = tokenJsonSchema(TOKEN_SCHEMA);
      expect(schema).toHaveProperty("type", "integer");
    });

    it("does not emit items or prefixItems (not an array schema)", () => {
      const schema = tokenJsonSchema(TOKEN_SCHEMA);
      expect(schema).not.toHaveProperty("items");
      expect(schema).not.toHaveProperty("prefixItems");
    });

    it("token property is marked required (not optional)", () => {
      const full = z.toJSONSchema(z.object({ token: TOKEN_SCHEMA }));
      const required = (full as Record<string, unknown>).required as string[] | undefined;
      expect(required ?? []).toContain("token");
    });

    it("all property schemas are objects or booleans (OpenAI rule)", () => {
      const toolInput = z.object({
        text: z.string(),
        token: TOKEN_SCHEMA,
      });

      const schema = z.toJSONSchema(toolInput) as Record<string, unknown>;
      const props = schema.properties as Record<string, unknown>;

      for (const [key, value] of Object.entries(props)) {
        const t = typeof value;
        expect(
          t === "object" || t === "boolean",
          `property "${key}" should be object or boolean, got ${t}`,
        ).toBe(true);
      }
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
        token: TOKEN_SCHEMA,
      });

      const schema = z.toJSONSchema(toolInput) as Record<string, unknown>;
      expect(schema).toHaveProperty("type", "object");

      const props = schema.properties as Record<string, Record<string, unknown>>;
      expect(props.text).toHaveProperty("type", "string");
      expect(props.token).toHaveProperty("type", "integer");
    });
  });
});

describe("decodeToken", () => {
  it("decodes a simple token correctly", () => {
    const sid = 1;
    const pin = 123456;
    const token = sid * 1_000_000 + pin;
    expect(decodeToken(token)).toEqual({ sid: 1, pin: 123456 });
  });

  it("decodes token for sid=3, pin=366556", () => {
    const token = 3 * 1_000_000 + 366556;
    expect(decodeToken(token)).toEqual({ sid: 3, pin: 366556 });
  });

  it("decodes token for sid=7, pin=303780", () => {
    const token = 7 * 1_000_000 + 303780;
    expect(decodeToken(token)).toEqual({ sid: 7, pin: 303780 });
  });

  it("decodes token for sid=1, pin=0 (edge: pin=0)", () => {
    const token = 1 * 1_000_000 + 0;
    expect(decodeToken(token)).toEqual({ sid: 1, pin: 0 });
  });

  it("decodes token for sid=1, pin=999999 (max pin)", () => {
    const token = 1 * 1_000_000 + 999999;
    expect(decodeToken(token)).toEqual({ sid: 1, pin: 999999 });
  });

  it("decodes token for sid=10, pin=123456 (multi-digit sid)", () => {
    const token = 10 * 1_000_000 + 123456;
    expect(decodeToken(token)).toEqual({ sid: 10, pin: 123456 });
  });

  it("is the inverse of token encoding", () => {
    for (const [sid, pin] of [[1, 100000], [3, 366556], [7, 303780], [2, 457250]]) {
      const token = sid * 1_000_000 + pin;
      expect(decodeToken(token)).toEqual({ sid, pin });
    }
  });
});

describe("consumeTokenStringHint", () => {
  it("returns hint string when token was passed as a numeric string", () => {
    const hint = runInTokenHintContext(() => {
      TOKEN_SCHEMA.safeParse("1000000");
      return consumeTokenStringHint();
    });
    expect(hint).toBe("token was passed as a string — use a plain integer for better performance");
  });

  it("returns undefined when token was passed as an integer", () => {
    const hint = runInTokenHintContext(() => {
      TOKEN_SCHEMA.safeParse(1000000);
      return consumeTokenStringHint();
    });
    expect(hint).toBeUndefined();
  });

  it("resets the flag after consumption (second call returns undefined)", () => {
    const second = runInTokenHintContext(() => {
      TOKEN_SCHEMA.safeParse("1000000");
      consumeTokenStringHint(); // consume
      return consumeTokenStringHint();
    });
    expect(second).toBeUndefined();
  });

  it("returns undefined when a non-numeric string is rejected (flag not set)", () => {
    const hint = runInTokenHintContext(() => {
      TOKEN_SCHEMA.safeParse("abc");
      return consumeTokenStringHint();
    });
    expect(hint).toBeUndefined();
  });

  it("isolates hint state between concurrent contexts (race-condition guard)", async () => {
    // Simulate two concurrent requests: first parses a string token, second an integer.
    // Each should see only its own hint.
    const results = await Promise.all([
      new Promise<string | undefined>((resolve) => {
        runInTokenHintContext(() => {
          TOKEN_SCHEMA.safeParse("1000000"); // string → wasString = true
          // Yield to allow the other context to run, then consume hint.
          void Promise.resolve().then(() => {
            resolve(consumeTokenStringHint());
          });
        });
      }),
      new Promise<string | undefined>((resolve) => {
        runInTokenHintContext(() => {
          TOKEN_SCHEMA.safeParse(1000000); // integer → wasString = false
          void Promise.resolve().then(() => {
            resolve(consumeTokenStringHint());
          });
        });
      }),
    ]);

    // First context should see the string hint; second should see undefined.
    expect(results[0]).toBe("token was passed as a string — use a plain integer for better performance");
    expect(results[1]).toBeUndefined();
  });

  it("returns undefined outside any async context (safe fallback)", () => {
    // Calling consumeTokenStringHint with no runInTokenHintContext active
    // should return undefined gracefully, not throw.
    TOKEN_SCHEMA.safeParse("1000000");
    const hint = consumeTokenStringHint();
    expect(hint).toBeUndefined();
  });
});
