import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toResult, toError, resolveChat } from "../telegram.js";
import { startAnimation, getPreset } from "../animation-state.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";

const DESCRIPTION =
  "Post a cycling placeholder message managed by the server. " +
  "One frame = static; multiple frames = cycling animation (min 1000ms interval). " +
  "Only one animation runs at a time — new one cancels the previous. " +
  "Modes: temporary (default, disappears on next bot message) or persistent (restarts after each message). " +
  "Built-in presets: bounce, dots, working, thinking, loading. " +
  "Avoid cycling emoji-only frames — Telegram renders solo emoji as large animated stickers. " +
  "Spaces become non-breaking by default (prevents layout shift); set allow_breaking_spaces: true to opt out. " +
  "For a native typing indicator in the chat header, use show_typing instead. " +
  "Call `help(topic: 'show_animation')` for details.";

export async function handleShowAnimation({
  preset, frames, interval = 1000, timeout = 600, persistent = false,
  allow_breaking_spaces = false, notify = false, priority = 0, token,
}: {
  preset?: string;
  frames?: string[];
  interval?: number;
  timeout?: number;
  persistent?: boolean;
  allow_breaking_spaces?: boolean;
  notify?: boolean;
  priority?: number;
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);

  // Resolve frames: preset > explicit frames > session default
  let resolvedFrames: string[] | undefined;
  if (preset) {
    const presetFrames = getPreset(_sid, preset);
    if (!presetFrames) return toError(`Unknown animation preset: "${preset}"`);
    resolvedFrames = [...presetFrames];
  } else if (frames) {
    resolvedFrames = frames;
  }
  // undefined → startAnimation uses getDefaultFrames(sid) internally

  try {
    const message_id = await startAnimation(_sid, resolvedFrames, interval, timeout, persistent, allow_breaking_spaces, notify, priority);
    return toResult({ message_id, persistent });
  } catch (err) {
    return toError(err);
  }
}

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
        priority: z
          .number()
          .int()
          .default(0)
          .describe("Priority level for the animation stack (default 0). Higher priority sessions are displayed over lower-priority ones. Ties broken by recency (most recently started wins)."),
              token: TOKEN_SCHEMA,
},
    },
    handleShowAnimation,
  );
}
