/**
 * Pre-tool-use hook registry.
 *
 * Hooks fire before the original tool handler executes (before authentication
 * in the handler). A hook can block a call by returning
 * `{ allowed: false, reason: "..." }`.
 *
 * Usage:
 *   setPreToolHook(myHook);
 *   // In server.ts wrapper:
 *   const { allowed, reason } = await invokePreToolHook(name, args);
 *   if (!allowed) return toError({ code: "BLOCKED", message: reason ?? "Blocked by pre-tool hook" });
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PreToolHookResult =
  | { allowed: true; hookError?: never }
  | { allowed: false; reason?: string; hookError?: true };

export type PreToolHook = (
  toolName: string,
  args: Record<string, unknown>,
) => PreToolHookResult | Promise<PreToolHookResult>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GLOB_META_CHARS_RE = /[-[\]{}()+?.,\\^$|#\s]/g;
const GLOB_WILDCARD_RE = /\*/g;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

let _hook: PreToolHook | undefined;

/** Register a pre-tool hook.  Replaces any previously registered hook. */
export function setPreToolHook(hook: PreToolHook): void {
  _hook = hook;
}

/** Remove the currently registered hook (restores pass-through behaviour). */
export function clearPreToolHook(): void {
  _hook = undefined;
}

function formatHookError(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * Invoke the registered hook (if any) and return the result.
 * Returns `{ allowed: true }` when no hook is registered.
 */
export async function invokePreToolHook(
  toolName: string,
  args: Record<string, unknown>,
): Promise<PreToolHookResult> {
  if (!_hook) return { allowed: true };
  try {
    return await _hook(toolName, args);
  } catch (err) {
    const errorMessage = formatHookError(err);
    console.error(`Pre-tool hook failed for "${toolName}": ${errorMessage}`);
    return { allowed: false, reason: "Hook error — see server logs for details.", hookError: true };
  }
}

// ---------------------------------------------------------------------------
// Built-in deny-pattern hook
// ---------------------------------------------------------------------------

/**
 * Build a hook that blocks tool calls whose names match any of the supplied
 * patterns.  Patterns are treated as:
 *   - glob-style `*` wildcard matching the tool name (`?` and other special chars are treated as literals), OR
 *   - exact string equality
 *
 * Example patterns: `["shutdown", "download_*"]`
 */
export function buildDenyPatternHook(patterns: string[]): PreToolHook {
  const compiled = patterns.map((p) => {
    // Convert simple glob (* only) to a RegExp so we avoid a full glob library
    // dependency.  Anything without * is matched as a literal.
    if (!p.includes("*")) {
      return (name: string) => name === p;
    }
    const escaped = p.replace(GLOB_META_CHARS_RE, "\\$&").replace(GLOB_WILDCARD_RE, ".*");
    const re = new RegExp(`^${escaped}$`);
    return (name: string) => re.test(name);
  });

  return (toolName) => {
    for (let i = 0; i < compiled.length; i++) {
      if (compiled[i]?.(toolName)) {
        return { allowed: false, reason: `Tool "${toolName}" is blocked by deny pattern "${patterns[i]}"` };
      }
    }
    return { allowed: true };
  };
}

/** Reset for tests. */
export function resetToolHooksForTest(): void {
  _hook = undefined;
}

/**
 * Tools that remain fail-closed on hook errors.
 * A hook error on these tools blocks the call (existing behaviour).
 * All other tools fail-open: hook errors are logged but the call proceeds.
 *
 * Criteria: tools that affect session lifecycle, operator delegation, or
 * bridge termination — where a silent pass-through on hook failure would
 * create a security gap or irreversible side effect.
 */
export const FAIL_CLOSED_TOOLS = new Set<string>([
  "session_start",   // establishes authenticated sessions
  "approve_agent",   // grants operator-delegated session access
  "shutdown",        // terminates the bridge process (irreversible)
  "close_session",   // governor-only: terminates another agent's session
]);
