import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  toResult, toError, validateText, resolveChat, validateCallbackData, LIMITS,
} from "../../telegram.js";
import { registerCallbackHook, registerPersistentCallbackHook } from "../../message-store.js";
import { requireAuth } from "../../session-gate.js";
import {
  sendChoiceMessage, ackAndEditSelection, buildHighlightedRows, highlightThenCollapse,
  type KeyboardOption,
} from "../button-helpers.js";
import { TOKEN_SCHEMA } from "../identity-schema.js";
import { validateButtonSymbolParity } from "../../button-validation.js";

const DESCRIPTION =
  "Non-blocking one-shot keyboard — sends a message with choice buttons and " +
  "returns immediately with a message_id. On first button press the keyboard " +
  "highlights the chosen option and collapses within ~250 ms (highlight-then-collapse). " +
  "The callback_query event still appears in dequeue so the agent can read " +
  "which option was picked at its own pace. " +
  "Pass persistent: true to opt into multi-tap control-panel mode where the " +
  "keyboard stays visible after each press and every tap is handled. " +
  "Use choose for blocking single-selection (waits for the press). " +
  "For a blocking yes/no or multi-option selection, use confirm or choose.";

const optionSchema = z.object({
  label: z
    .string()
    .describe(
      `Button label. Keep under ${LIMITS.BUTTON_DISPLAY_MULTI_COL} chars for 2-col layout, ` +
      `or ${LIMITS.BUTTON_DISPLAY_SINGLE_COL} chars for single-column. ` +
      `API hard limit is ${LIMITS.BUTTON_TEXT} chars.`,
    ),
  value: z
    .string()
    .describe(`Callback data returned when pressed (max ${LIMITS.CALLBACK_DATA} bytes)`),
  style: z
    .enum(["success", "primary", "danger"])
    .optional()
    .describe("Button color: success (green), primary (blue), danger (red). Omit for default."),
});

export type ChoiceOption = { label: string; value: string; style?: "success" | "primary" | "danger" };

export async function handleSendChoice({
  text, options, columns = 2, parse_mode = "Markdown", disable_notification,
  reply_to, ignore_parity, persistent, topic, token,
}: {
  text: string;
  options: ChoiceOption[];
  columns?: number;
  parse_mode?: "Markdown" | "HTML" | "MarkdownV2";
  disable_notification?: boolean;
  reply_to?: number;
  ignore_parity?: boolean;
  /** When true, keyboard stays after each press (multi-tap control-panel mode).
   *  Default false = one-shot highlight-then-collapse. */
  persistent?: boolean;
  topic?: string;
  token: number;
}) {
  const _sid = requireAuth(token);
  if (typeof _sid !== "number") return toError(_sid);
  const chatId = resolveChat();
  if (typeof chatId !== "number") return toError(chatId);

  const textErr = validateText(text);
  if (textErr) return toError(textErr);

  // Validate button symbol parity
  if (!ignore_parity) {
    const parity = validateButtonSymbolParity(options.map((o) => o.label));
    if (!parity.ok) {
      return toError({
        code: "BUTTON_SYMBOL_PARITY" as const,
        message: `Button labels are inconsistent: ${parity.withEmoji.length} of ${options.length} have emoji. Either add emoji to all labels or remove them. Pass ignore_parity: true to send anyway.`,
        labels_with_emoji: parity.withEmoji,
        labels_without_emoji: parity.withoutEmoji,
      });
    }
  }

  // Validate options — same rules as choose
  const displayMax = columns >= 2
    ? LIMITS.BUTTON_DISPLAY_MULTI_COL
    : LIMITS.BUTTON_DISPLAY_SINGLE_COL;
  for (const opt of options) {
    const dataErr = validateCallbackData(opt.value);
    if (dataErr) return toError(dataErr);
    if (opt.label.length > LIMITS.BUTTON_TEXT) {
      return toError({
        code: "BUTTON_LABEL_EXCEEDS_LIMIT" as const,
        message: `Button label "${opt.label}" is ${opt.label.length} chars; hard limit is ${LIMITS.BUTTON_TEXT}.`,
      });
    }
    if (opt.label.length > displayMax) {
      return toError({
        code: "BUTTON_LABEL_TOO_LONG" as const,
        message:
          `Button label "${opt.label}" (${opt.label.length} chars) will be cut off on mobile. ` +
          `With columns=${columns}, keep labels under ${displayMax} chars.`,
      });
    }
  }

  const replyTo = reply_to;

  try {
    const messageId = await sendChoiceMessage(chatId, {
      text,
      options: options as KeyboardOption[],
      columns,
      parseMode: parse_mode,
      disableNotification: disable_notification,
      replyToMessageId: replyTo,
      topicOverride: topic,
    });

    // Register callback hook. Behaviour depends on persistent mode:
    //
    // One-shot (default, persistent !== true):
    //   Two-stage highlight-then-collapse — chosen button highlighted immediately,
    //   keyboard removed + selection suffix appended ~250 ms later.
    //   The hook is one-shot; a second tap between stage 1 and stage 2 is ignored
    //   (the hook has already fired and won't re-enter this path).
    //
    // Persistent (persistent === true):
    //   Multi-tap control-panel mode — keyboard stays visible after each press,
    //   chosen button highlighted in primary, repeat presses allowed.
    //   Uses registerPersistentCallbackHook so the hook re-registers itself
    //   after each fire, enabling genuine multi-tap support.
    //
    // ownerSid tracks the session so teardown can replace the hook with a "Session closed" ack.
    const hookFn = (evt: import("../../message-store.js").TimelineEvent) => {
      const qid = evt.content.qid;
      const clickedValue = evt.content.data ?? "";
      const matched = options.find((o) => o.value === clickedValue);
      const label = (matched?.label ?? clickedValue) || "?";
      const highlighted = buildHighlightedRows(options as KeyboardOption[], columns, clickedValue);

      if (persistent) {
        // Persistent / multi-tap: keep keyboard visible with highlight after each press.
        // Pass delayMs=0 so the highlight update fires immediately without the
        // collapse delay (no keyboard removal is happening here).
        void ackAndEditSelection(chatId, messageId, text, label, qid, false, highlighted, 0);
      } else {
        // One-shot: highlight immediately, then collapse keyboard after ~250 ms.
        void highlightThenCollapse(chatId, messageId, text, label, qid, highlighted);
      }
    };
    if (persistent) {
      registerPersistentCallbackHook(messageId, hookFn, _sid);
    } else {
      registerCallbackHook(messageId, hookFn, _sid);
    }

    return toResult({ message_id: messageId });
  } catch (err) {
    return toError(err);
  }
}

export function register(server: McpServer) {
  server.registerTool(
    "send_choice",
    {
      description: DESCRIPTION,
      inputSchema: {
        text: z.string().describe("Message text — the question or prompt shown above the buttons"),
        options: z
          .array(optionSchema)
          .min(2)
          .max(8)
          .describe("2–8 options. Laid out per the columns setting."),
        columns: z
          .number()
          .int()
          .min(1)
          .max(4)
          .default(2)
          .describe("Buttons per row (default 2)"),
        parse_mode: z
          .enum(["Markdown", "HTML", "MarkdownV2"])
          .default("Markdown")
          .describe("Markdown = auto-converted (default); MarkdownV2 = raw; HTML = HTML tags"),
        disable_notification: z
          .boolean()
          .optional()
          .describe("Send silently (no sound/notification)"),
        reply_to: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Reply to this message ID"),
        ignore_parity: z
          .boolean()
          .optional()
          .describe("Set true to bypass button label emoji-consistency check"),
        persistent: z
          .boolean()
          .optional()
          .describe(
            "Set true to enable multi-tap control-panel mode: the keyboard stays visible " +
            "after each press, the chosen button is highlighted, and every tap is handled. " +
            "Default false = one-shot highlight-then-collapse (~250 ms).",
          ),
        topic: z
          .string()
          .optional()
          .describe("Per-message topic override. When provided, uses this string as the topic header for THIS message only — overrides the profile-level topic without mutating it. Pass an empty string to suppress the topic for this one message."),
              token: TOKEN_SCHEMA,
},
    },
    handleSendChoice,
  );
}
