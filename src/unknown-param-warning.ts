/**
 * Unknown-parameter warning middleware.
 *
 * Compares incoming tool arguments against the tool's registered Zod schema,
 * strips unrecognised parameters, and appends a `warning` field to the tool
 * response so callers know which params were silently dropped.
 *
 * The call is never rejected — the tool always executes with the valid subset.
 */

// ---------------------------------------------------------------------------
// Core logic (pure, no I/O — easy to unit-test)
// ---------------------------------------------------------------------------

/**
 * Given the set of known parameter names for a tool and the incoming argument
 * object, return:
 *   - `clean`   — a new object with unknown keys removed
 *   - `warning` — a human-readable warning string, or `undefined` when every
 *                 key in `args` is recognised
 *
 * @param toolName    - The tool's registered name (used in the warning message).
 * @param knownParams - The full set of parameter names declared in the schema.
 * @param args        - The raw incoming argument object.
 */
export function checkUnknownParams(
  toolName: string,
  knownParams: ReadonlySet<string>,
  args: Record<string, unknown>,
): { clean: Record<string, unknown>; warning: string | undefined } {
  const unknownKeys: string[] = [];
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (knownParams.has(key)) {
      clean[key] = value;
    } else {
      unknownKeys.push(key);
    }
  }

  if (unknownKeys.length === 0) {
    return { clean: args, warning: undefined };
  }

  const unknownList = unknownKeys.map(k => `'${k}'`).join(", ");
  const acceptsList = knownParams.size === 0
    ? undefined
    : [...knownParams].sort().join(", ");
  const acceptsSuffix = acceptsList
    ? ` ${toolName} accepts: ${acceptsList}.`
    : ` ${toolName} accepts no parameters.`;
  const plural = unknownKeys.length === 1 ? "parameter" : "parameters";
  const warning =
    `Unknown ${plural} ${unknownList} ${unknownKeys.length === 1 ? "was" : "were"} ignored.` +
    acceptsSuffix;

  return { clean, warning };
}

// ---------------------------------------------------------------------------
// Response-merging helper
// ---------------------------------------------------------------------------

/**
 * Inject a `warning` field into an MCP tool result.
 *
 * The MCP result format is `{ content: [{ type: "text", text: "<json>" }] }`.
 * This function parses the JSON payload, adds the `warning` key, and
 * re-serialises it.  If the payload cannot be parsed (unusual) it is left
 * unchanged.
 */
export function injectWarningIntoResult(
  result: unknown,
  warning: string,
): unknown {
  try {
    const r = result as { content?: Array<{ type: string; text?: string }> };
    if (!Array.isArray(r.content) || r.content.length === 0) return result;
    const first = r.content[0];
    if (first.type !== "text" || typeof first.text !== "string") return result;

    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    // Preserve existing warning if any (prepend ours).
    if (typeof parsed.warning === "string") {
      parsed.warning = `${warning} ${parsed.warning}`;
    } else {
      parsed.warning = warning;
    }

    return {
      ...r,
      content: [
        { ...first, text: JSON.stringify(parsed, null, 2) },
        ...r.content.slice(1),
      ],
    };
  } catch {
    // If we cannot parse the payload, return as-is — never break the call.
    return result;
  }
}
