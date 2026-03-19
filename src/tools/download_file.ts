import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join, extname, basename } from "path";
import { z } from "zod";
import { getApi, toResult, toError } from "../telegram.js";
import { cancelTyping, showTyping } from "../typing-state.js";
import { requireAuth } from "../session-gate.js";
import { IDENTITY_SCHEMA } from "./identity-schema.js";

/** Text-based MIME types and extensions that are safe to read as UTF-8 */
const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".csv", ".log", ".yaml", ".yml", ".toml", ".ini",
  ".env", ".json", ".xml", ".html", ".htm", ".css", ".ts", ".js",
  ".mjs", ".cjs", ".jsx", ".tsx", ".py", ".rb", ".rs", ".go", ".java",
  ".cs", ".c", ".cpp", ".h", ".hpp", ".sh", ".bash", ".zsh", ".fish",
  ".ps1", ".psm1", ".sql", ".graphql", ".gql", ".tf", ".proto",
]);

const MAX_TEXT_BYTES = 100 * 1024; // 100 KB

function isTextFile(fileName: string | undefined, mimeType: string | undefined): boolean {
  if (mimeType && TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return true;
  if (fileName && TEXT_EXTENSIONS.has(extname(fileName).toLowerCase())) return true;
  return false;
}

const DESCRIPTION =
  "Downloads a file from Telegram by file_id and saves it to a local temp " +
  "directory. Returns the local path, file name, MIME type, and file size. " +
  "For text-based files under 100 KB, also returns the file contents as " +
  "`text`. Only call this after the user has chosen an action that requires " +
  "the file — do not download speculatively.";

export function register(server: McpServer) {
  server.registerTool(
    "download_file",
    {
      description: DESCRIPTION,
      inputSchema: {
        file_id: z
        .string()
        .describe("The Telegram file_id from a message event (e.g. document.file_id, voice.file_id) delivered by dequeue_update or get_message"),
      file_name: z
        .string()
        .optional()
        .describe("Suggested file name (used for folder naming and text detection). Pass the file_name from the message if available."),
      mime_type: z
        .string()
        .optional()
        .describe("MIME type hint from the message, used to determine if text contents should be returned."),
              identity: IDENTITY_SCHEMA,
},
    },
    async ({ file_id, file_name, mime_type, identity}) => {
      const _sid = requireAuth(identity);
      if (typeof _sid !== "number") return toError(_sid);
      try {
        await showTyping(30);
        const token = process.env.BOT_TOKEN;
        if (!token) {
          return toError({ code: "UNKNOWN" as const, message: "BOT_TOKEN not set — cannot download file." });
        }

        // 1. Resolve file path from Telegram
        const fileInfo = await getApi().getFile(file_id);
        if (!fileInfo.file_path) {
          return toError({ code: "UNKNOWN" as const, message: "Telegram returned no file_path for this file_id. The file may be too large (>20 MB) or expired." });
        }

        // 2. Download bytes
        const url = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
        const res = await fetch(url);
        if (!res.ok) {
          return toError({ code: "UNKNOWN" as const, message: `Download failed: ${res.status} ${res.statusText}` });
        }
        const bytes = Buffer.from(await res.arrayBuffer());

        // 3. Determine local file name (sanitized to prevent path traversal; timestamp prefix prevents collisions)
        const rawName = file_name ?? fileInfo.file_path.split("/").pop() ?? "file";
        const displayName = basename(rawName).replace(/^\.+/, "") || "file";
        const resolvedName = `${Date.now()}_${displayName}`;

        // 4. Save to temp directory with restricted permissions
        const dir = join(tmpdir(), "telegram-bridge-mcp");
        await mkdir(dir, { recursive: true });
        const localPath = join(dir, resolvedName);
        await writeFile(localPath, bytes, { mode: 0o600 });

        // 5. Return text content for small text files
        const fileSize = bytes.byteLength;
        let text: string | undefined;
        if (fileSize <= MAX_TEXT_BYTES && isTextFile(resolvedName, mime_type)) {
          text = bytes.toString("utf-8");
        }

        cancelTyping();
        return toResult({
          local_path: localPath,
          file_name: displayName,
          mime_type: mime_type ?? null,
          file_size: fileSize,
          ...(text !== undefined ? { text } : {}),
        });
      } catch (err) {
        cancelTyping();
        return toError(err);
      }
    }
  );
}
