import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError } from "../telegram.js";
import { getSessionVoice, setSessionVoice, clearSessionVoice, getSessionSpeed, setSessionSpeed, clearSessionSpeed } from "../voice-state.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Sets a per-session TTS voice override (e.g. \"alloy\", \"nova\", \"echo\"). " +
  "Overrides the global default for this session only — other sessions are unaffected. " +
  "Pass an empty string to clear the override and revert to the global default. " +
  "Use list_voices (if available) to discover the voices supported by your TTS provider.";

export function handleSetVoice({ voice, speed, token }: { voice: string; speed?: number; token: number }) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const previous = getSessionVoice();
  const previousSpeed = getSessionSpeed();
  if (voice.trim() === "") {
    clearSessionVoice();
    clearSessionSpeed();
    return toResult({ voice: null, speed: null, previous, previousSpeed, cleared: true });
  }
  setSessionVoice(voice);
  if (speed !== undefined) {
    setSessionSpeed(speed);
  }
  return toResult({ voice: getSessionVoice(), speed: getSessionSpeed(), previous, previousSpeed, set: true });
}

export function register(server: McpServer) {
  server.registerTool(
    "set_voice",
    {
      description: DESCRIPTION,
      inputSchema: {
        voice: z
          .string()
          .max(64)
          .describe("Voice name to set for this session, e.g. \"alloy\". Pass empty string to clear."),
        speed: z
          .number()
          .min(0.25)
          .max(4.0)
          .optional()
          .describe("TTS speed multiplier (0.25–4.0, default 1.0). Omit to leave speed unchanged."),
        token: TOKEN_SCHEMA,
      },
    },
    handleSetVoice,
  );
}
