// Never call 'send' from send.ts handler — use telegram.js primitives directly
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, validateText, resolveChat, splitMessage, callApi, sendVoiceDirect } from "../telegram.js";
import { markdownToV2 } from "../markdown.js";
import { applyTopicToText, getTopic } from "../topic-state.js";
import { showTyping, typingGeneration, cancelTypingIfSameGeneration } from "../typing-state.js";
import { isTtsEnabled, stripForTts, synthesizeToOgg } from "../tts.js";
import { getSessionVoice, getSessionSpeed } from "../voice-state.js";
import { getDefaultVoice } from "../config.js";
import { requireAuth } from "../session-gate.js";
import { TOKEN_SCHEMA } from "./identity-schema.js";
import { findUnrenderableChars } from "../unrenderable-chars.js";
import { deliverServiceMessage } from "../session-queue.js";
import { enqueueAsyncSend, acquireRecordingIndicator, releaseRecordingIndicator } from "../async-send-queue.js";
import { getFirstUseHint, appendHintToResult, markFirstUseHintSeen } from "../first-use-hints.js";
import { SERVICE_MESSAGES } from "../service-messages.js";
// Type-routing handlers (v6 Phase 2)
import { handleSendFile } from "./send/file.js";
import { handleNotify } from "./send/notify.js";
import { handleSendChoice } from "./send/choice.js";
import { handleSendDirectMessage } from "./send/dm.js";
import { handleAppendText } from "./send/append.js";
import { handleShowAnimation } from "./animation/show.js";
import { handleSendNewChecklist } from "./checklist/update.js";
import { handleSendNewProgress } from "./progress/new.js";
import { handleAsk } from "./send/ask.js";
import { handleChoose } from "./send/choose.js";
import { handleConfirm } from "./confirm/handler.js";
import { detectCaptionDuplication, type DuplicationResult } from "../hybrid-duplication-detector.js";

const TABLE_WARNING = "Message sent. Note: markdown tables were detected but not formatted — Telegram does not support table rendering.";

const AUDIO_LEAK_PATTERNS = [
  /<\/audio>/i,
  /<parameter\s+name=/i,
  /<\/parameter>/i,
  /<\/invoke>/i,
  /<\/function_calls>/i,
  /<invoke\s+name=/i,
] as const;

function detectAudioMarkupLeak(raw: string): { cleanAudio: string; recoveredText: string | null; leaked: boolean } {
  let firstIdx = -1;
  for (const pat of AUDIO_LEAK_PATTERNS) {
    const m = pat.exec(raw);
    if (m !== null && (firstIdx === -1 || m.index < firstIdx)) firstIdx = m.index;
  }
  if (firstIdx === -1) return { cleanAudio: raw, recoveredText: null, leaked: false };
  const cleanAudio = raw.slice(0, firstIdx).trimEnd();
  const suffix = raw.slice(firstIdx);
  const textMatch = /<(?:antml:)?parameter\s+name="text">([\s\S]*?)<\/(?:antml:)?parameter>/i.exec(suffix);
  return { cleanAudio, recoveredText: textMatch ? textMatch[1].trim() : null, leaked: true };
}

const MARKDOWN_TABLE_RE = /^\|.*\|$/;

function containsMarkdownTable(text: string): boolean {
  return text.split("\n").some((line) => MARKDOWN_TABLE_RE.test(line.trim()));
}

/** Scan text for unrenderable chars and deliver a service warning to the session if any are found. */
function warnUnrenderableChars(sid: number, text: string): void {
  const badChars = findUnrenderableChars(text);
  if (badChars.length > 0) {
    const charList = badChars
      .map(c => `\`${c}\` (U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")})`)
      .join(", ");
    deliverServiceMessage(
      sid,
      `Message sent, but some characters may not render in Telegram: ${charList}. Use ASCII alternatives.`,
      "unrenderable_chars_warning",
    );
  }
}

/** Delivers the caption-duplication nudge service message if the result indicates a duplicate. */
function deliverCaptionDuplicationNudge(sid: number, dup: DuplicationResult | null): void {
  if (dup?.isDuplicate) {
    deliverServiceMessage(
      sid,
      SERVICE_MESSAGES.NUDGE_CAPTION_DUPLICATION,
      { jaccard: Math.round(dup.jaccard * 100) / 100, audioWords: dup.audioWords, captionWords: dup.captionWords },
    );
  }
}

/** Returns the closest string in `candidates` to `input`, or null if no reasonable match. */
function findClosestMatch(input: string, candidates: readonly string[]): string | null {
  if (candidates.length === 0 || input.length === 0) return null;
  const lower = input.toLowerCase();
  const sub = candidates.find(c => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase()));
  if (sub) return sub;
  const withDist = candidates.map(c => ({ c, d: levenshtein(lower, c.toLowerCase()) }));
  const best = withDist.reduce((a, b) => (a.d < b.d ? a : b));
  return best.d <= 3 ? best.c : null;
}

/** Simple Levenshtein distance. */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

const _parsedTimeout = Number(process.env.ASYNC_SEND_TIMEOUT_MS);
const _timeoutMs = Number.isFinite(_parsedTimeout) && _parsedTimeout > 0 ? _parsedTimeout : 300_000;

const SEND_TYPES = ["text", "file", "notification", "choice", "dm", "append", "animation", "checklist", "progress", "question"] as const;
type SendType = (typeof SEND_TYPES)[number];

/** Backward-compat aliases — accepted but not advertised in discovery or error messages. */
const SEND_ALIASES: readonly string[] = ["direct"];

const DESCRIPTION =
  "Send a message as text, audio (TTS), or both. " +
  "text only → text message with auto-split and Markdown. " +
  "audio only → TTS voice note (spoken content). " +
  "Both → voice note with text as caption (keep brief — topic context before playback). " +
  "At least one of text or audio is required. " +
  "For structured status, use notify. For file attachments, use send_file. " +
  "For interactive prompts, use ask, choose, or confirm. " +
  "Pass type: \"<type>\" to route to a specific mode. " +
  "Call with no args to see available types.";

const BUTTON_STYLE_SCHEMA = z.enum(["success", "primary", "danger"]);
const OPTION_SCHEMA = z.object({
  label: z.string(),
  value: z.string(),
  style: BUTTON_STYLE_SCHEMA.optional(),
});
const STEP_SCHEMA = z.object({
  label: z.string(),
  status: z.enum(["pending", "running", "done", "failed", "skipped"]),
  detail: z.string().optional(),
});

export function register(server: McpServer) {
  server.registerTool(
    "send",
    {
      description: DESCRIPTION,
      inputSchema: {
        type: z
          .string()
          .optional()
          .describe('Emission mode: "text" (default), "file", "notification", "choice", "dm", "append", "animation", "checklist", "progress", "question". Optional — omit to default to "text". The "text" type handles text-only, audio-only, and audio+text (voice note with caption) automatically.'),
        // ── text / voice ───────────────────────────────────────────────────
        text: z
          .string()
          .optional()
          .describe("Text message OR caption when audio is also provided. At least one of text/audio required."),
        audio: z
          .string()
          .min(1)
          .optional()
          .describe("Spoken TTS content. When present, sends a voice note. Requires TTS to be configured."),
        parse_mode: z
          .enum(["Markdown", "HTML", "MarkdownV2"])
          .default("Markdown")
          .describe("For text content only. Default Markdown (auto-converted)."),
        disable_notification: z.boolean().optional().describe("Send silently (no sound/notification)"),
        reply_to: z.number().int().min(1).optional().describe("Reply to this message ID"),
        async: z.boolean().optional().describe("Applies to audio sends only. Defaults to async when audio is present — returns message_id_pending immediately; pass false to block until TTS completes and receive real message_id. Has no effect on non-audio sends."),
        // ── file ───────────────────────────────────────────────────────────
        file: z.string().optional().describe("Local path, HTTPS URL, or file_id (for type: \"file\")"),
        file_type: z
          .enum(["auto", "photo", "document", "video", "audio", "voice"])
          .default("auto")
          .describe("Media type for file upload (default: auto-detect by extension)"),
        caption: z.string().optional().describe("File caption (for type: \"file\")"),
        // ── notification ───────────────────────────────────────────────────
        title: z.string().optional().describe("Heading (for type: \"notification\", \"checklist\", \"progress\"). For checklist/progress, `text` is accepted as an alias."),
        severity: z
          .enum(["info", "success", "warning", "error"])
          .default("info")
          .describe("Severity level for notifications"),
        message: z.string().optional().describe("Alias for text in all modes. When provided and text is absent, resolves to text. Canonical parameter: 'text'."),
        // ── direct ─────────────────────────────────────────────────────────
        target_sid: z.number().int().optional().describe("Target session ID (for type: \"dm\")"),
        target: z.number().int().optional().describe("Alias for target_sid (for type: \"dm\"). Use either target or target_sid, not both."),
        // ── append ─────────────────────────────────────────────────────────
        message_id: z.number().int().optional().describe("Message ID to append to (for type: \"append\")"),
        separator: z.string().default("\n").describe("Separator for append mode"),
        // ── choice / question.choose ────────────────────────────────────────
        options: z.array(OPTION_SCHEMA).optional().describe("Button options (for type: \"choice\"; also accepted as alias for \"choose\" in type: \"question\")"),
        choose: z.array(OPTION_SCHEMA).optional().describe("Button options for type: \"question\" choose mode (alias: \"options\")"),
        columns: z.number().int().min(1).max(4).default(2).describe("Buttons per row (default 2)"),
        ignore_parity: z.boolean().optional().describe("Bypass button emoji parity check"),
        // ── animation ──────────────────────────────────────────────────────
        preset: z.string().optional().describe("Animation preset name"),
        frames: z.array(z.string()).optional().describe("Animation frame strings"),
        interval: z.number().int().min(1000).max(10000).default(1000).describe("Frame interval ms"),
        timeout: z.number().int().min(5).max(600).default(60).describe("Animation auto-cleanup timeout in seconds (min 5, max 600, default 60). Pass a low value (e.g. 5) to auto-cancel after N seconds."),
        persistent: z.boolean().default(false).describe("Keep animation running after messages"),
        allow_breaking_spaces: z.boolean().default(false).describe("Allow breaking spaces in animation"),
        notify_animation: z.boolean().default(false).describe("Notify on animation start"),
        priority: z.number().int().default(0).describe("Animation priority level"),
        // ── checklist ──────────────────────────────────────────────────────
        steps: z.array(STEP_SCHEMA).optional().describe("Checklist steps (for type: \"checklist\")"),
        // ── progress ───────────────────────────────────────────────────────
        percent: z.number().int().min(0, { message: "percent must be 0\u2013100. Call help(topic: 'send') for progress usage." }).max(100, { message: "percent must be 0\u2013100. Call help(topic: 'send') for progress usage." }).optional().describe("Progress percentage 0\u2013100 (for type: \"progress\")"),
        width: z.number().int().min(1).max(40).default(10).describe("Progress bar width (default 10)"),
        subtext: z.string().optional().describe("Progress bar subtext"),
        // ── question sub-types ─────────────────────────────────────────────
        ask: z.string().optional().describe("Free-text question for type: \"question\" ask mode"),
        confirm: z.string().optional().describe("Confirmation text for type: \"question\" confirm mode"),
        timeout_seconds: z.number().int().min(1).max(86400).optional().describe("Timeout for interactive question types (seconds). Omit to use the server maximum (24 h)."),
        ignore_pending: z.boolean().optional().describe("Skip pending-updates check for interactive types"),
        yes_text: z.string().default("OK").describe("Affirmative button label (for confirm)"),
        no_text: z.string().default("Cancel").describe("Negative button label (for confirm)"),
        yes_data: z.string().default("confirm_yes").describe("Affirmative callback data"),
        no_data: z.string().default("confirm_no").describe("Negative callback data"),
        yes_style: BUTTON_STYLE_SCHEMA.default("primary").describe("Affirmative button color"),
        no_style: BUTTON_STYLE_SCHEMA.optional().describe("Negative button color"),
        token: TOKEN_SCHEMA.describe(
          "Session token from action(type: 'session/start') (sid * 1_000_000 + suffix). Required for all send paths.",
        ),
        response_format: z
          .enum(["default", "compact"])
          .optional()
          .describe("Response format. \"compact\" omits inferrable fields (split: true, split_count, timed_out: false, voice: true) to reduce token usage. Defaults to \"default\"."),
      },
    },
    async (args, { signal }) => {
      // 'message' is a universal alias for 'text' — resolve before any routing
      const { type, audio } = args;
      const text = args.text ?? args.message;

      const _sid = requireAuth(args.token);
      if (typeof _sid !== "number") return toError(_sid);
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      // Discovery mode: no type, text, or audio → list available types
      if (!type && !text && !audio) {
        return toResult({
          available_types: SEND_TYPES,
        });
      }

      // Validate type against the known enum before entering the switch
      if (type !== undefined && !(SEND_TYPES as readonly string[]).includes(type) && !SEND_ALIASES.includes(type)) {
        const suggestion = findClosestMatch(type, SEND_TYPES);
        const hasAudio = !!audio;
        const hasText = !!text;
        const isAudioTextMix = hasAudio && hasText;

        const hint = isAudioTextMix
          ? `For audio + text together, omit "type" entirely (or use type: "text") — it routes to hybrid voice-with-caption automatically.`
          : hasAudio
          ? `For audio-only voice notes, omit "type" or use type: "text". Call help(topic: 'send') for usage.`
          : suggestion
          ? `Did you mean type: "${suggestion}"? Call help(topic: 'send') for usage.`
          : `Call help(topic: 'send') to see all available types and their required params.`;

        return toError({
          code: "UNKNOWN_TYPE" as const,
          message: `Unknown type: "${type}". Available types: ${SEND_TYPES.join(", ")}.`,
          hint,
        });
      }

      // Normalize backward-compat aliases to canonical types
      const resolvedType: SendType = type === "direct" ? "dm" : ((type as SendType | undefined) ?? "text");

      switch (resolvedType) {
        case "text": {
          if (!text && !audio) {
            return toError({ code: "MISSING_CONTENT" as const, message: "At least one of 'text' or 'audio' is required.", hint: "Call help(topic: 'send') for usage. Both text and audio are optional individually but at least one is required." });
          }
          const { parse_mode, disable_notification } = args;
          const reply_to_message_id = args.reply_to;
          const compact = args.response_format === "compact";

          // ── Voice mode ───────────────────────────────────────────────────
          if (audio) {
            const { cleanAudio, recoveredText, leaked: audioLeaked } = detectAudioMarkupLeak(audio);
            const effectiveAudio = audioLeaked ? cleanAudio : audio;
            const effectiveText = text ?? (audioLeaked && recoveredText ? recoveredText : undefined);
            let leakWarning: { code: string; message: string } | undefined;
            if (audioLeaked) {
              leakWarning = {
                code: "AUDIO_MARKUP_LEAK",
                message: "Audio payload contained tool-call markup (`</audio>` or `<parameter name=`). Stripped before TTS; recovered caption from trailing `<parameter name=\"text\">` block. Your client may be emitting parameters without the antml:parameter namespace — check hybrid emission on long audio strings.",
              };
              process.stderr.write(`[send] AUDIO_MARKUP_LEAK detected sid=${_sid} recoveredText=${recoveredText !== null ? "yes" : "no"}\n`);
            }
            if (!isTtsEnabled()) {
              return toError({ code: "TTS_NOT_CONFIGURED", message: "TTS is not configured. Set TTS_HOST or OPENAI_API_KEY to use voice.", hint: "Set TTS_HOST or OPENAI_API_KEY environment variable to enable voice." } as const);
            }
            const plainText = stripForTts(effectiveAudio);
            if (!plainText) {
              return toError({ code: "EMPTY_MESSAGE", message: "Voice text is empty after stripping formatting for TTS.", hint: "Provide non-empty audio text for TTS." } as const);
            }
            const resolvedVoice = getSessionVoice() ?? getDefaultVoice() ?? undefined;
            const resolvedSpeed = getSessionSpeed() ?? undefined;
            let resolvedCaption: string | undefined;
            let captionParseMode: "MarkdownV2" | undefined;
            let captionOverflow = false;
            let finalTextForSplit: string | undefined;
            if (effectiveText) {
              const MAX_CAPTION = 1024 - 60;
              const converted = markdownToV2(applyTopicToText(effectiveText, "Markdown"));
              captionOverflow = converted.length > MAX_CAPTION;
              if (captionOverflow) {
                resolvedCaption = undefined;
                finalTextForSplit = converted;
              } else {
                resolvedCaption = converted;
                captionParseMode = "MarkdownV2";
              }
            } else {
              const topic = getTopic();
              if (topic) {
                resolvedCaption = markdownToV2(`**[${topic}]**`);
                captionParseMode = "MarkdownV2";
              }
            }

            const dup = effectiveText
              ? detectCaptionDuplication(effectiveAudio, effectiveText)
              : null;

            // ── Async TTS path ────────────────────────────────────────────
            if (args.async !== false) {
              const pendingId = enqueueAsyncSend(_sid, {
                sid: _sid,
                chatId,
                audioText: plainText,
                captionText: captionOverflow ? finalTextForSplit : resolvedCaption,
                captionOverflow,
                resolvedVoice,
                resolvedSpeed,
                disableNotification: disable_notification,
                replyToMessageId: reply_to_message_id,
                timeoutMs: _timeoutMs,
              });
              deliverCaptionDuplicationNudge(_sid, dup);
              return toResult({ ok: true, message_id_pending: pendingId, status: "queued", ...(leakWarning ? { warning: leakWarning } : {}) });
            }
            const voiceChunks = splitMessage(plainText);
            for (const chunk of voiceChunks) {
              const chunkErr = validateText(chunk);
              if (chunkErr) return toError(chunkErr);
            }
            // Initial typing budget: generous estimate; extended per-chunk below.
            const typingSeconds = Math.max(5, Math.ceil(plainText.length / 20));
            // RECORD_VOICE_EXTEND_SECS: how far ahead to push the deadline before
            // each synthesis+upload so the indicator never drops mid-operation.
            const RECORD_VOICE_EXTEND_SECS = 30;
            // gen is updated after each showTyping() so cancelTypingIfSameGeneration
            // always targets the most recent generation, not a stale pre-start value.
            let gen = typingGeneration();
            let voiceStarted = false;
            const recordingEpoch = acquireRecordingIndicator(chatId);
            try {
              await showTyping(typingSeconds, "record_voice");
              gen = typingGeneration();
              const message_ids: number[] = [];
              for (let i = 0; i < voiceChunks.length; i++) {
                // Extend the recording indicator deadline before each chunk so it
                // stays visible throughout the full TTS synthesis + upload cycle,
                // even for long messages where synthesis takes many seconds.
                // showTyping() detects the already-running interval and only
                // updates the deadline — no extra Telegram API call is made.
                await showTyping(RECORD_VOICE_EXTEND_SECS, "record_voice");
                gen = typingGeneration();
                const ogg = await synthesizeToOgg(voiceChunks[i], resolvedVoice, resolvedSpeed);
                const isFirst = i === 0;
                const msg = await sendVoiceDirect(chatId, ogg, {
                  caption: isFirst ? resolvedCaption : undefined,
                  ...(captionParseMode ? { parse_mode: captionParseMode } : {}),
                  disable_notification,
                  reply_to_message_id: isFirst ? reply_to_message_id : undefined,
                });
                message_ids.push(msg.message_id);
                voiceStarted = true; // at least one chunk successfully delivered
              }
              if (captionOverflow && finalTextForSplit) {
                const splitText = finalTextForSplit;
                const textMsg = await callApi(() =>
                  getApi().sendMessage(chatId, splitText, {
                    parse_mode: "MarkdownV2",
                    disable_notification,
                  } as Record<string, unknown>),
                );
                // Scan the overflow text for unrenderable characters after it is sent
                warnUnrenderableChars(_sid, splitText);
                deliverCaptionDuplicationNudge(_sid, dup);
                if (message_ids.length === 1) {
                  return toResult({
                    message_id: message_ids[0],
                    text_message_id: textMsg.message_id,
                    ...(compact ? {} : { split: true }),
                    audio: true,
                    _hint: `Caption exceeded limit; audio sent as msg ${message_ids[0]}, text sent separately as msg ${textMsg.message_id}.`,
                    ...(leakWarning ? { warning: leakWarning } : {}),
                  });
                }
                return toResult({
                  message_ids,
                  text_message_id: textMsg.message_id,
                  ...(compact ? {} : { split: true }),
                  audio: true,
                  _hint: `Caption exceeded limit; audio sent as msgs ${message_ids.join(", ")}, text sent separately as msg ${textMsg.message_id}.`,
                  ...(leakWarning ? { warning: leakWarning } : {}),
                });
              }
              // Scan the inline caption for unrenderable characters after voice is sent
              if (resolvedCaption) {
                warnUnrenderableChars(_sid, resolvedCaption);
              }
              deliverCaptionDuplicationNudge(_sid, dup);
              if (message_ids.length === 1) {
                return toResult({ message_id: message_ids[0], ...(leakWarning ? { warning: leakWarning } : {}) });
              }
              return toResult({ message_ids, ...(compact ? {} : { split_count: message_ids.length, split: true }), audio: true, ...(leakWarning ? { warning: leakWarning } : {}) });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (msg.includes("user restricted receiving of voice note messages")) {
                return toError({
                  code: "VOICE_RESTRICTED",
                  message: "Telegram blocked voice delivery — the user's privacy settings restrict voice notes from bots. To fix: Telegram → Settings → Privacy and Security → Voice Messages → Add Exceptions → Always Allow → add this bot.",
                } as const);
              }
              return toError(err);
            } finally {
              // Order matters: delay first so the recording indicator stays visible
              // during the post-send render window, then cancel typing, then release.
              // Releasing before the delay would briefly expose a "typing" tick
              // during the 3 s window when the voice message is still rendering.
              // Use voiceStarted (not voiceSent) so the delay also applies when at
              // least one chunk was delivered but a later chunk failed — the first
              // chunk is still rendering on the client.
              if (voiceStarted) {
                // Voice messages take 2-5s to render after API confirmation; keep indicator alive.
                await new Promise<void>(resolve => setTimeout(resolve, 3000));
              }
              cancelTypingIfSameGeneration(gen);
              releaseRecordingIndicator(chatId, recordingEpoch);
            }
          }

          // ── Text-only mode ───────────────────────────────────────────────
          const textWithTopic = applyTopicToText(text ?? "", parse_mode);
          const finalText = parse_mode === "Markdown" ? markdownToV2(textWithTopic) : textWithTopic;
          const finalMode = parse_mode === "Markdown" ? "MarkdownV2" : parse_mode;
          if (!finalText || finalText.trim().length === 0) {
            return toError({ code: "EMPTY_MESSAGE" as const, message: "Message text must not be empty. Provide a non-empty string in the text field." });
          }
          const chunks = splitMessage(finalText);
          try {
            const message_ids: number[] = [];
            for (let i = 0; i < chunks.length; i++) {
              const chunk = chunks[i];
              const textErr = validateText(chunk);
              if (textErr) return toError(textErr);
              const msg = await callApi(() =>
                getApi().sendMessage(chatId, chunk, {
                  parse_mode: finalMode,
                  disable_notification,
                  reply_parameters:
                    i === 0 && reply_to_message_id !== undefined
                      ? { message_id: reply_to_message_id }
                      : undefined,
                  _rawText: chunks.length === 1 ? text : undefined,
                } as Record<string, unknown>),
              );
              message_ids.push(msg.message_id);
            }
            const hasTable = containsMarkdownTable(text ?? "");
            warnUnrenderableChars(_sid, finalText);
            if (message_ids.length === 1) {
              return toResult(hasTable ? { message_id: message_ids[0], info: TABLE_WARNING } : { message_id: message_ids[0] });
            }
            return toResult(hasTable
              ? { message_ids, ...(compact ? {} : { split_count: message_ids.length, split: true }), info: TABLE_WARNING }
              : { message_ids, ...(compact ? {} : { split_count: message_ids.length, split: true }) });
          } catch (err) {
            return toError(err);
          }
        }

        case "file":
          if (!args.file) return toError({ code: "MISSING_PARAM" as const, message: 'type: "file" requires a "file" param (path, URL, or file_id).', hint: "Call help(topic: 'send') \u2014 type: \"file\" requires a file path or URL." });
          return handleSendFile({
            file: args.file,
            type: args.file_type,
            caption: args.caption,
            parse_mode: args.parse_mode,
            disable_notification: args.disable_notification,
            reply_to: args.reply_to,
            token: args.token,
          });

        case "notification":
          if (!args.title) return toError({ code: "MISSING_PARAM" as const, message: 'type: "notification" requires a "title" param.', hint: "Call help(topic: 'send') for the required params for this type." });
          return handleNotify({
            title: args.title,
            text: args.text,
            message: args.message,
            severity: args.severity,
            parse_mode: args.parse_mode,
            disable_notification: args.disable_notification,
            reply_to: args.reply_to,
            token: args.token,
          });

        case "choice":
          if (!text) return toError({ code: "MISSING_PARAM" as const, message: 'type: "choice" requires a "text" param.', hint: "Call help(topic: 'send') for the required params for this type." });
          if (!args.options?.length) return toError({ code: "MISSING_PARAM" as const, message: 'type: "choice" requires an "options" array.', hint: "Call help(topic: 'send') for the required params for this type." });
          return appendHintToResult(
            await handleSendChoice({
              text,
              options: args.options,
              columns: args.columns,
              parse_mode: args.parse_mode,
              disable_notification: args.disable_notification,
              reply_to: args.reply_to,
              ignore_parity: args.ignore_parity,
              token: args.token,
            }),
            getFirstUseHint(_sid, "send:choice"),
          );

        case "dm": {
          const targetA = args.target_sid;
          const targetB = args.target;
          if (targetA !== undefined && targetB !== undefined && targetA !== targetB)
            return toError({ code: "CONFLICT" as const, message: 'Both "target_sid" and "target" were provided with different values. Use one or the other.' });
          const resolvedTarget = targetA ?? targetB;
          if (!resolvedTarget) return toError({ code: "MISSING_PARAM" as const, message: 'type: "dm" requires a "target_sid" (or "target") param.', hint: "Call help(topic: 'send') for the required params for this type." });
          if (!text) return toError({ code: "MISSING_PARAM" as const, message: 'type: "dm" requires a "text" param.', hint: "Call help(topic: 'send') for the required params for this type." });
          const dmResult = handleSendDirectMessage({ token: args.token, target_sid: resolvedTarget, text });
          // Inject compression reminder on first DM this session (only on success)
          if (!(dmResult as { isError?: boolean }).isError &&
              markFirstUseHintSeen(_sid, "compression_hint_dm")) {
            deliverServiceMessage(_sid, SERVICE_MESSAGES.COMPRESSION_HINT_FIRST_DM);
          }
          return dmResult;
        }

        case "append":
          if (!args.message_id) return toError({ code: "MISSING_PARAM" as const, message: 'type: "append" requires a "message_id" param.', hint: "Call help(topic: 'send') for the required params for this type." });
          if (!text) return toError({ code: "MISSING_PARAM" as const, message: 'type: "append" requires a "text" param.', hint: "Call help(topic: 'send') for the required params for this type." });
          return appendHintToResult(
            await handleAppendText({
              message_id: args.message_id,
              text,
              separator: args.separator,
              parse_mode: args.parse_mode,
              token: args.token,
            }),
            getFirstUseHint(_sid, "send:append"),
          );

        case "animation":
          return appendHintToResult(
            await handleShowAnimation({
              preset: args.preset,
              frames: args.frames,
              interval: args.interval,
              timeout: args.timeout,
              persistent: args.persistent,
              allow_breaking_spaces: args.allow_breaking_spaces,
              notify: args.notify_animation,
              priority: args.priority,
              token: args.token,
            }),
            getFirstUseHint(_sid, "send:animation"),
          );

        case "checklist":
          {
            const checklistTitle = args.title ?? text;
            if (!checklistTitle) return toError({ code: "MISSING_PARAM" as const, message: 'type: "checklist" requires a "title" param.', hint: "type: \"checklist\" requires title (string) and steps (array). Call help(topic: 'send')." });
            if (!args.steps?.length) return toError({ code: "MISSING_PARAM" as const, message: 'type: "checklist" requires a "steps" array.', hint: "type: \"checklist\" requires title (string) and steps (array). Call help(topic: 'send')." });
            return appendHintToResult(
              await handleSendNewChecklist({ title: checklistTitle, steps: args.steps, token: args.token }),
              getFirstUseHint(_sid, "send:checklist"),
            );
          }

        case "progress":
          if (args.percent === undefined) return toError({ code: "MISSING_PARAM" as const, message: 'type: "progress" requires a "percent" param (0\u2013100).', hint: "type: \"progress\" requires a percent (0\u2013100). Call help(topic: 'send')." });
          return appendHintToResult(
            await handleSendNewProgress({
              percent: args.percent,
              title: args.title ?? text,
              subtext: args.subtext,
              width: args.width,
              token: args.token,
            }),
            getFirstUseHint(_sid, "send:progress"),
          );

        case "question": {
          if (args.ask !== undefined) {
            return handleAsk({
              question: args.ask,
              timeout_seconds: args.timeout_seconds,
              reply_to: args.reply_to,
              ignore_pending: args.ignore_pending,
              token: args.token,
              response_format: args.response_format,
            }, signal);
          }
          if (args.choose !== undefined || args.options !== undefined) {
            const chooseButtons = (args.choose ?? args.options) as NonNullable<typeof args.choose>;
            if (!text) return toError({ code: "MISSING_PARAM" as const, message: 'type: "question" with choose requires a "text" param (prompt shown above buttons).', hint: "Call help(topic: 'send') for question param requirements." });
            return appendHintToResult(
              await handleChoose({
                text,
                options: chooseButtons,
                timeout_seconds: args.timeout_seconds,
                columns: args.columns,
                reply_to: args.reply_to,
                ignore_pending: args.ignore_pending,
                ignore_parity: args.ignore_parity,
                audio: args.audio,
                token: args.token,
                response_format: args.response_format,
              }, signal),
              getFirstUseHint(_sid, "send:question:choose"),
            );
          }
          if (args.confirm !== undefined) {
            return handleConfirm({
              text: args.confirm,
              yes_text: args.yes_text,
              no_text: args.no_text,
              yes_data: args.yes_data,
              no_data: args.no_data,
              yes_style: args.yes_style,
              no_style: args.no_style,
              timeout_seconds: args.timeout_seconds,
              reply_to: args.reply_to,
              ignore_pending: args.ignore_pending,
              ignore_parity: args.ignore_parity,
              audio: args.audio,
              token: args.token,
              response_format: args.response_format,
            }, signal);
          }
          return toError({ code: "MISSING_QUESTION_TYPE" as const, message: 'For type "question", provide one of: ask (string), choose (ChoiceOption[]), or confirm (string).', hint: "Pass one of: ask (string), choose (array), or confirm (string) with type: \"question\"." });
        }

        default:
          // This path is unreachable at runtime — unknown types are caught above
          // before the switch. TypeScript exhaustiveness check only.
          return toError({ code: "UNKNOWN_TYPE" as const, message: `Unknown type: "${resolvedType as string}".` });
      }
    },
  );
}
