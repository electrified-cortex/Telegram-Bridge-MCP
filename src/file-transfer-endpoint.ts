/**
 * HTTP file-transfer endpoints.
 *
 * POST /files
 *   Authorization: Bearer <session_token>
 *   Body: raw bytes (any Content-Type)
 *   Returns: { url: "http://localhost:<port>/files/<uuid>", expires_in: 300 }
 *   Returns 401 on missing/invalid token, 400 on empty body.
 *
 * GET /files/<uuid>
 *   Authorization: Bearer <session_token>
 *   Returns the stored file body with original Content-Type.
 *   Deletes the entry on first successful download (one-time token).
 *   Returns 401 on auth failure, 404 if entry is absent or expired.
 *
 * Auth uses the same session token integer as all other endpoints.
 * Token is encoded in the Authorization header: `Bearer <integer>`.
 */

import type { Request, Response, Express } from "express";
import { decodeToken } from "./tools/identity-schema.js";
import { validateSession } from "./session-manager.js";
import { putFile, getAndDeleteFile } from "./file-store.js";
import { getSseBaseUrl } from "./http-mode.js";
import { DIGITS_ONLY } from "./utils/patterns.js";

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/** Extract the numeric session token from an Authorization: Bearer header. */
function parseTokenFromBearer(authHeader: string | undefined): number | null {
  if (typeof authHeader !== "string") return null;
  if (!authHeader.startsWith("Bearer ")) return null;
  const raw = authHeader.slice(7).trim();
  if (!DIGITS_ONLY.test(raw) || raw.length === 0) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Validate the session token from an Authorization header. */
export function isValidAuthHeader(authHeader: string | undefined): boolean {
  const token = parseTokenFromBearer(authHeader);
  if (token === null) return false;
  const { sid, suffix } = decodeToken(token);
  return validateSession(sid, suffix);
}

// ---------------------------------------------------------------------------
// Body reading
// ---------------------------------------------------------------------------

/** Read the raw request body as a Buffer (works even when body-parser is installed). */
async function readBodyBuffer(req: Request): Promise<Buffer> {
  // If a raw-body middleware already ran, prefer its result.
  if (Buffer.isBuffer(req.body)) return req.body;
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => { resolve(Buffer.concat(chunks)); });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Pure handler functions (exported for unit testing without HTTP)
// ---------------------------------------------------------------------------

/**
 * Core logic for POST /files.
 * Returns [statusCode, responseBody].
 */
export function handlePostFiles(
  authHeader: string | undefined,
  contentType: string | undefined,
  body: Buffer,
  baseUrl: string | null,
): [number, Record<string, unknown>] {
  if (!isValidAuthHeader(authHeader)) {
    return [401, { ok: false, error: "Unauthorized" }];
  }
  if (body.byteLength === 0) {
    return [400, { ok: false, error: "Empty body — send file bytes in the request body" }];
  }
  const ct = (contentType ?? "application/octet-stream").split(";")[0].trim() || "application/octet-stream";
  const uuid = putFile(body, ct);
  const base = baseUrl ?? "http://127.0.0.1";
  return [200, { url: `${base}/files/${uuid}`, expires_in: 300 }];
}

/**
 * Core logic for GET /files/:uuid.
 */
export function handleGetFile(
  authHeader: string | undefined,
  uuid: string,
): { status: number; json?: Record<string, unknown>; buffer?: Buffer; contentType?: string } {
  if (!isValidAuthHeader(authHeader)) {
    return { status: 401, json: { ok: false, error: "Unauthorized" } };
  }
  const entry = getAndDeleteFile(uuid);
  if (!entry) {
    return { status: 404, json: { ok: false, error: "Not found or expired" } };
  }
  return { status: 200, buffer: entry.buffer, contentType: entry.contentType };
}

// ---------------------------------------------------------------------------
// Express route attachment
// ---------------------------------------------------------------------------

export function attachFileTransferRoutes(app: Express): void {
  // POST /files — upload a file, get back a one-time URL
  app.post("/files", (req: Request, res: Response): void => {
    void (async () => {
      try {
        // Auth check BEFORE body read — prevents unauthenticated callers from
        // forcing arbitrary memory allocation prior to receiving 401.
        // handlePostFiles retains its own auth check for unit-test coverage.
        if (!isValidAuthHeader(req.headers["authorization"])) {
          res.status(401).json({ ok: false, error: "Unauthorized" });
          return;
        }
        const body = await readBodyBuffer(req);
        const [status, payload] = handlePostFiles(
          req.headers["authorization"],
          typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : undefined,
          body,
          getSseBaseUrl(),
        );
        if (!res.headersSent) res.status(status).json(payload);
      } catch {
        if (!res.headersSent) res.status(500).json({ ok: false, error: "Upload failed" });
      }
    })();
  });

  // GET /files/:uuid — download a file (one-time)
  app.get("/files/:uuid", (req: Request, res: Response): void => {
    const rawUuid = req.params["uuid"];
    const result = handleGetFile(
      req.headers["authorization"],
      typeof rawUuid === "string" ? rawUuid : "",
    );
    if (result.json !== undefined) {
      res.status(result.status).json(result.json);
      return;
    }
    if (result.buffer !== undefined) {
      res.setHeader("Content-Type", result.contentType ?? "application/octet-stream");
      res.setHeader("Content-Length", result.buffer.byteLength);
      res.status(result.status).send(result.buffer);
      return;
    }
    res.status(result.status).end();
  });
}
