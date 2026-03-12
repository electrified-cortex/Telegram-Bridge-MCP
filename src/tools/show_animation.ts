import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, resolveChat } from "../telegram.js";
import { startAnimation, DEFAULT_FRAMES } from "../animation-state.js";

const DESCRIPTION =
  "Start a server-managed cycling visual placeholder message. The animation " +
  "auto-cancels after timeout seconds of inactivity. One frame = static placeholder. " +
  "Multiple frames = cycling animation (min 1000ms interval). " +
  "Only one animation at a time — starting a new one cancels the previous. " +
  "Cancel with cancel_animation, or let it auto-clean on timeout. " +
  "A single emoji works well as a static placeholder (e.g. [\"🤔\"] or [\"⏳\"]). " +
  "Avoid cycling multiple emoji-only frames — Telegram renders solo emoji as large animated stickers, so rapid edits look jarring.";

export function register(server: McpServer) {
  server.registerTool(
    "show_animation",
    {
      description: DESCRIPTION,
      inputSchema: {
        frames: z
          .array(z.string())
          .default([...DEFAULT_FRAMES])
          .describe("Animation frames. Single frame = static placeholder. Default: [\".\", \"..\", \"...\"]. A single emoji (e.g. [\"🤔\"]) works great as a static placeholder. Avoid cycling multiple emoji-only frames (Telegram renders them as large animated stickers)."),
        interval: z
          .number()
          .int()
          .min(1000)
          .max(10000)
          .default(1000)
          .describe("Milliseconds between frames (min 1000, default 1000). Ignored if single frame."),
        timeout: z
          .number()
          .int()
          .min(5)
          .max(600)
          .default(30)
          .describe("Seconds of inactivity before auto-cleanup (default 30, max 600)"),
      },
    },
    async ({ frames, interval, timeout }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      try {
        const message_id = await startAnimation(frames, interval, timeout);
        return toResult({ message_id });
      } catch (err) {
        return toError(err);
      }
    },
  );
}
