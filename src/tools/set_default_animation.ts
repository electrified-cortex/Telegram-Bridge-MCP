import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { requireAuth } from "../session-gate.js";
import {
  setSessionDefault,
  resetSessionDefault,
  registerPreset,
  getDefaultFrames,
  listPresets,
  listBuiltinPresets,
  DEFAULT_FRAMES,
} from "../animation-state.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Configure the session's default animation frames and manage named presets. " +
  "Pass frames to set the session default (what show_animation() uses with no args). " +
  "Pass name + frames to register a named preset for later recall via show_animation(preset: name). " +
  "Call with reset: true to restore the built-in default. " +
  "Call with no args to list current default and registered presets.";

export function register(server: McpServer) {
  server.registerTool(
    "set_default_animation",
    {
      description: DESCRIPTION,
      inputSchema: {
        frames: z
          .array(z.string())
          .min(1)
          .optional()
          .describe("Animation frames to set as the new default or to register as a preset."),
        name: z
          .string()
          .optional()
          .describe("Register frames as a named preset with this key. If omitted, frames are set as the session default."),
        reset: z
          .boolean()
          .default(false)
          .describe("Reset the session default back to the built-in animation. Ignores frames/name."),
              token: TOKEN_SCHEMA,
},
    },
    ({ frames, name, reset, token}) => {
      const _sid = requireAuth(token);
      if (typeof _sid !== "number") return toError(_sid);
      // Reset mode
      if (reset) {
        resetSessionDefault(_sid);
        return toResult({
          action: "reset",
          default_frames: [...DEFAULT_FRAMES],
          presets: listPresets(_sid),
        });
      }

      // No-args: query mode
      if (!frames) {
        return toResult({
          default_frames: [...getDefaultFrames(_sid)],
          session_presets: listPresets(_sid),
          builtin_presets: listBuiltinPresets(),
        });
      }

      // Register named preset
      if (name) {
        registerPreset(_sid, name, frames);
        return toResult({
          action: "preset_registered",
          name,
          frames,
          presets: listPresets(_sid),
        });
      }

      // Set session default
      setSessionDefault(_sid, frames);
      return toResult({
        action: "default_set",
        default_frames: frames,
        presets: listPresets(_sid),
      });
    },
  );
}
