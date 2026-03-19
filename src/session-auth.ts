import { z } from "zod";
import { validateSession } from "./session-manager.js";
import { toError } from "./telegram.js";
import { dlog } from "./debug-log.js";

/** Zod fields to spread into any tool's inputSchema that requires auth. */
export const SESSION_AUTH_SCHEMA = {
  sid: z.number().int().positive().describe("Session ID from session_start"),
  pin: z.number().int().describe("Session PIN from session_start"),
};

/**
 * Validate session credentials extracted from tool args.
 * Returns `undefined` on success or an MCP error result on failure.
 */
export function checkAuth(
  sid: number,
  pin: number,
): ReturnType<typeof toError> | undefined {
  if (!validateSession(sid, pin)) {
    dlog("session", `auth failed sid=${sid}`, { reason: "invalid credentials" });
    return toError({
      code: "AUTH_FAILED",
      message: "Invalid session credentials",
    });
  }
  return undefined;
}
