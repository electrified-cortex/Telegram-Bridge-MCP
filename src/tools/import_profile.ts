import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { applyProfile } from "./apply-profile.js";

const DESCRIPTION =
  "Apply profile data inline without reading from a file. Accepts the same structure " +
  "as profile JSON files. All fields are optional — only provided fields are applied " +
  "(sparse merge). Use this to load profiles from external sources or to apply ad-hoc " +
  "configuration without saving a profile to disk first.";

export function register(server: McpServer) {
  server.registerTool(
    "import_profile",
    {
      description: DESCRIPTION,
      inputSchema: {
        voice: z.string().max(64).optional().describe("Voice name to use for TTS."),
        voice_speed: z
          .number()
          .min(0.25)
          .max(4.0)
          .optional()
          .describe("TTS playback speed multiplier (0.25–4.0)."),
        animation_default: z
          .array(z.string())
          .optional()
          .describe("Default animation frame sequence."),
        animation_presets: z
          .record(z.string(), z.array(z.string()))
          .optional()
          .describe("Named animation presets."),
        reminders: z
          .array(
            z.object({
              text: z.string(),
              delay_seconds: z.number(),
              recurring: z.boolean(),
            }),
          )
          .optional()
          .describe("Reminders to register for this session."),
        token: TOKEN_SCHEMA,
      },
    },
    ({ voice, voice_speed, animation_default, animation_presets, reminders, token }) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);

      const profile = {
        ...(voice !== undefined && { voice }),
        ...(voice_speed !== undefined && { voice_speed }),
        ...(animation_default !== undefined && { animation_default }),
        ...(animation_presets !== undefined && { animation_presets }),
        ...(reminders !== undefined && { reminders }),
      };

      const applyResult = applyProfile(_sid, profile);
      if ("code" in applyResult) return toError(applyResult);

      return toResult({ imported: true, applied: applyResult.applied });
    },
  );
}
