import { describe, it, expect } from "vitest";
import { isError, errorCode, type ToolHandler } from "../test-utils.js";

export function testIdentityGate(
  call: ToolHandler,
  validateSession: { mockReturnValueOnce: (value: boolean) => void },
  minArgs: Record<string, unknown> = {},
  fullSuite = true,
): void {
  describe("identity gate", () => {
    it("returns SID_REQUIRED when no identity provided", async () => {
      const result = await call(minArgs);
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("SID_REQUIRED");
    });

    it("returns AUTH_FAILED when identity has wrong suffix", async () => {
      validateSession.mockReturnValueOnce(false);
      const result = await call({ ...minArgs, token: 1099999 });
      expect(isError(result)).toBe(true);
      expect(errorCode(result)).toBe("AUTH_FAILED");
    });

    if (fullSuite) {
      it("proceeds when identity is valid", async () => {
        validateSession.mockReturnValueOnce(true);
        let code: string | undefined;
        try { code = errorCode(await call({ ...minArgs, token: 1099999 })); } catch { /* gate passed */ }
        expect(code).not.toBe("SID_REQUIRED");
        expect(code).not.toBe("AUTH_FAILED");
      });
    }
  });
}
