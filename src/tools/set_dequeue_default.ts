import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { setDequeueDefault, getDequeueDefault } from "../session-manager.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Set the per-session default timeout for dequeue calls. " +
  "Once set, all dequeue calls from this token use this as the default when timeout is not explicitly passed. " +
  "Scope: in-memory, session-lifetime only. Cleared when the session closes. " +
  "Priority: explicit timeout param > session default > server default (300s). " +
  "Use this at agent startup to configure your preferred polling interval. " +
  "Examples: persistent agent → 600, VS Code extension → 290, one-shot runner → no call needed.";

export function handleSetDequeueDefault({ token, timeout }: { token: number; timeout: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const sid = _sid;

  const previous = getDequeueDefault(sid);
  setDequeueDefault(sid, timeout);
  return toResult({ ok: true, timeout, previous });
}

export function register(server: McpServer) {
  server.registerTool(
    "set_dequeue_default",
    {
      description: DESCRIPTION,
      inputSchema: {
        token: TOKEN_SCHEMA,
        timeout: z
          .number()
          .int()
          .min(0)
          .max(3600)
          .describe(
            "Default timeout in seconds for dequeue. 0 = instant poll mode. " +
            "Maximum 3600 s (1 hour). Values above 3600 are rejected.",
          ),
      },
    },
    handleSetDequeueDefault,
  );
}
