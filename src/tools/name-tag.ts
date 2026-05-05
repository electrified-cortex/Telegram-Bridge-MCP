import { toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { getSession } from "../session-manager.js";

/**
 * Get or set the session name tag.
 *
 * GET (no `name_tag`): returns the effective name tag — explicit override if
 *   set, otherwise the auto-default `<color> <name>` (or just `<name>`).
 *
 * SET (with `name_tag`): validates and stores the override. Pass an empty
 *   string to reset to the auto-default.
 */
export function handleNameTag({ token, name_tag }: { token: number; name_tag?: string }) {
  const sid = requireAuth(token);
  if (typeof sid !== "number") return toError(sid);

  const session = getSession(sid);
  if (!session) return toError({ code: "SESSION_NOT_FOUND" as const, message: "Session not found." });

  if (name_tag !== undefined) {
    // Validate
    if (name_tag.includes("\n")) {
      return toError({ code: "INVALID_NAME_TAG" as const, message: "name_tag must not contain newlines." });
    }
    if (name_tag.length > 64) {
      return toError({ code: "INVALID_NAME_TAG" as const, message: "name_tag exceeds 64 characters." });
    }

    // Empty string resets to default (undefined = auto-compute)
    session.name_tag = name_tag.length > 0 ? name_tag : undefined;
    const resolvedName = session.name || `Session ${sid}`;
    const effective = session.name_tag ?? (session.color ? `${session.color} ${resolvedName}` : resolvedName);
    return toResult({ name_tag: effective, custom: session.name_tag !== undefined });
  }

  // GET
  const resolvedName = session.name || `Session ${sid}`;
  const effective = session.name_tag ?? (session.color ? `${session.color} ${resolvedName}` : resolvedName);
  return toResult({ name_tag: effective, custom: session.name_tag !== undefined });
}
