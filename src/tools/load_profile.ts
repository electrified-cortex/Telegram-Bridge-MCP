import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { IDENTITY_SCHEMA } from "./identity-schema.js";
import { readProfile } from "../profile-store.js";
import { applyProfile } from "./apply-profile.js";

const DESCRIPTION =
  "Restore a previously saved session profile. Sparse-merges into the current " +
  "session — keys present in the profile overwrite the session's current values; " +
  "absent keys are untouched. Multiple loads stack. " +
  "Use load_profile after session_start to bootstrap voice, animations, and reminders.";

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
        identity: IDENTITY_SCHEMA,
      },
    },
    ({ key, identity }) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);

      let profile;
      try {
        profile = readProfile(key);
      } catch (err) {
        return toError({ code: "READ_FAILED", message: (err as Error).message });
      }

      if (profile === null) {
        return toError({ code: "NOT_FOUND", message: `Profile not found: ${key}` });
      }

      const applyResult = applyProfile(_sid, profile);
      if ("code" in applyResult) return toError(applyResult);

      return toResult({ loaded: true, key, applied: applyResult.applied });
    },
  );
}
