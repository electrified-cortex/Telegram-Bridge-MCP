import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, resolveChat } from "../telegram.js";
import { startAnimation, getPreset } from "../animation-state.js";

const DESCRIPTION =
  "Start a server-managed cycling visual placeholder message. The animation " +
  "auto-cancels after timeout seconds of inactivity. One frame = static placeholder. " +
  "Multiple frames = cycling animation (min 1000ms interval). " +
  "Only one animation at a time — starting a new one cancels the previous. " +
  "Cancel with cancel_animation, or let it auto-clean on timeout. " +
  "A single emoji works well as a static placeholder (e.g. [\"🤔\"] or [\"⏳\"]). " +
  "Avoid cycling multiple emoji-only frames — Telegram renders solo emoji as large animated stickers, so rapid edits look jarring. " +
  "Pass a preset name to recall saved or built-in frames without re-specifying them. " +
  "Built-in presets: bounce (default tracer), dots, working, thinking, loading. " +
  "Two modes: temporary (default) = one-shot, disappears on next bot message or show_typing. " +
  "Persistent = continuous, restarts after each bot message until explicitly cancelled. " +
  "By default all regular spaces in frames are replaced with non-breaking spaces to prevent layout shift; " +
  "set allow_breaking_spaces: true to opt out. " +
  "Animations are silent by default (no notification). Set notify: true to trigger a notification on the initial placeholder. " +
  "For a brief native typing indicator in the chat header (seconds, pre-reply), use show_typing instead.";

export function register(server: McpServer) {
  server.registerTool(
    "show_animation",
    {
      description: DESCRIPTION,
      inputSchema: {
        preset: z
          .string()
          .optional()
          .describe("Name of a registered animation preset. If provided, its frames are used (ignoring the frames parameter). Use set_default_animation to register presets."),
        frames: z
          .array(z.string())
          .optional()
          .describe("Animation frames. Single frame = static placeholder. A single emoji (e.g. [\"🤔\"]) works great as a static placeholder. Avoid cycling multiple emoji-only frames (Telegram renders them as large animated stickers). Omit to use the session default."),
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
          .default(600)
          .describe("Seconds of inactivity before auto-cleanup (default 600, max 600)"),
        persistent: z
          .boolean()
          .default(false)
          .describe("If true, the animation restarts after each bot message (continuous streaming). Default false = one-shot, disappears on next message or show_typing."),
        allow_breaking_spaces: z
          .boolean()
          .default(false)
          .describe("If true, regular spaces in frames are kept as-is (not converted to non-breaking spaces). Default false converts spaces to NBSP for stable layout."),
        notify: z
          .boolean()
          .default(false)
          .describe("If true, the initial animation placeholder triggers a notification. Default false = silent (no ping/buzz)."),
      },
    },
    async ({ preset, frames, interval, timeout, persistent, allow_breaking_spaces, notify }) => {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      // Resolve frames: preset > explicit frames > session default
      let resolvedFrames: string[] | undefined;
      if (preset) {
        const presetFrames = getPreset(preset);
        if (!presetFrames) return toError(`Unknown animation preset: "${preset}"`);
        resolvedFrames = [...presetFrames];
      } else if (frames) {
        resolvedFrames = frames;
      }
      // undefined → startAnimation uses getDefaultFrames() internally

      try {
        const message_id = await startAnimation(resolvedFrames, interval, timeout, persistent, allow_breaking_spaces, notify);
        return toResult({ message_id, persistent });
      } catch (err) {
        return toError(err);
      }
    },
  );
}
