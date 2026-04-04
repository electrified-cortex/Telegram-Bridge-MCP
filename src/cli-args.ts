const DEFAULT_HTTP_PORT = 3099;
const DIGITS_ONLY = /^\d+$/;

/**
 * Resolves the HTTP port from CLI args or environment.
 * --http takes precedence over MCP_PORT env var.
 * Returns undefined if neither is set (stdio mode).
 * Throws RangeError on invalid port values.
 */
export function resolveHttpPort(
  argv: string[],
  env: Record<string, string | undefined>
): number | undefined {
  const httpFlagIdx = argv.indexOf("--http");

  if (httpFlagIdx !== -1) {
    const nextArg = argv[httpFlagIdx + 1] as string | undefined;
    if (nextArg !== undefined && DIGITS_ONLY.test(nextArg)) {
      const parsed = parseInt(nextArg, 10);
      if (parsed < 1 || parsed > 65535) {
        throw new RangeError(
          `Invalid port "${nextArg}" after --http. ` +
          "Expected an integer between 1 and 65535."
        );
      }
      return parsed;
    }
    return DEFAULT_HTTP_PORT;
  }

  const rawMcpPort = env["MCP_PORT"];
  if (typeof rawMcpPort === "string" && rawMcpPort.length > 0) {
    const parsed = parseInt(rawMcpPort, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new RangeError(`Invalid MCP_PORT "${rawMcpPort}". Expected an integer between 1 and 65535.`);
    }
    return parsed;
  }

  return undefined;
}
