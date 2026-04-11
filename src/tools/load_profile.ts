import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { readProfile } from "../profile-store.js";
import { applyProfile } from "./apply-profile.js";

const DESCRIPTION =
  "Restore a previously saved session profile. Sparse-merges into the current " +
  "session — keys present in the profile overwrite the session's current values; " +
  "absent keys are untouched. Multiple loads stack. " +
  "Use load_profile after session_start to bootstrap voice, animations, and reminders.";

export function handleLoadProfile({ key, token }: { key: string; token: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);

  let profile;
  try {
    profile = readProfile(key);
  } catch (err) {
    return toError({ code: "READ_FAILED", message: `Failed to read profile "${key}": ${(err as Error).message}. Check that the file exists and is valid JSON.` });
  }

  if (profile === null) {
    return toError({ code: "NOT_FOUND", message: `Profile not found: "${key}". Call save_profile(key: "${key}") to create it, or check the key spelling.` });
  }

  const applyResult = applyProfile(_sid, profile);
  if ("code" in applyResult) return toError(applyResult);

  return toResult({ loaded: true, key, applied: applyResult.applied });
}

export function register(server: McpServer) {
  server.registerTool(
    "load_profile",
    {
      description: DESCRIPTION,
      inputSchema: {
        key: z
          .string()
          .min(1)
          .max(200)
          .describe(
            "Profile key to load. Bare name (e.g. \"Overseer\") loads from data/profiles/. " +
            "Path key (e.g. \"profiles/Overseer\") loads relative to repo root.",
          ),
        token: TOKEN_SCHEMA,
      },
    },
    handleLoadProfile,
  );
}
