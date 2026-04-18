import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

// ---------------------------------------------------------------------------
// Hoisted mocks - must be at top
// ---------------------------------------------------------------------------
const FAKE_TMPDIR = vi.hoisted(() => "/tmp/fake");

const mocks = vi.hoisted(() => ({
  activeSessionCount: vi.fn(() => 0),
  getActiveSession: vi.fn(() => 0),
  validateSession: vi.fn(() => false),
  getFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("os", () => ({
  tmpdir: () => FAKE_TMPDIR,
}));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getApi: () => mocks };
});

vi.mock("fs/promises", () => ({
  writeFile: mocks.writeFile,
  mkdir: mocks.mkdir,
}));

vi.mock("../session-manager.js", () => ({
  activeSessionCount: () => mocks.activeSessionCount(),
  getActiveSession: () => mocks.getActiveSession(),
  validateSession: mocks.validateSession,
}));

// Mock global fetch
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { register } from "./download_file.js";
import { resetSecurityConfig } from "../telegram.js";

describe("download_file tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  const envBefore = { BOT_TOKEN: process.env.BOT_TOKEN, ALLOWED_USER_ID: process.env.ALLOWED_USER_ID };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateSession.mockReturnValue(true);
    process.env.BOT_TOKEN = "testtoken123";
    process.env.ALLOWED_USER_ID = "12345";
    resetSecurityConfig();
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);

    const server = createMockServer();
    register(server);
    call = server.getHandler("download_file");
  });

  afterEach(() => {
    process.env.BOT_TOKEN = envBefore.BOT_TOKEN;
    process.env.ALLOWED_USER_ID = envBefore.ALLOWED_USER_ID;
    resetSecurityConfig();
  });

  // -------------------------------------------------------------------------

  it("downloads a binary file and returns local_path and metadata", async () => {
    mocks.getFile.mockResolvedValue({ file_path: "documents/AgAD_abc.pdf", file_size: 5000 });
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength)),
    });

    const result = await call({ file_id: "fileABC", file_name: "report.pdf", mime_type: "application/pdf", token: 1123456});

    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.local_path).toContain("report.pdf");
    expect(data.file_name).toBe("report.pdf");
    expect(data.mime_type).toBe("application/pdf");
    expect(data.file_size).toBe(4);
    // Binary PDF — no text property
    expect(data.text).toBeUndefined();

    // Correct download URL used
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.telegram.org/file/bottesttoken123/documents/AgAD_abc.pdf"
    );
  });

  it("infers file name from Telegram file_path when file_name is omitted", async () => {
    mocks.getFile.mockResolvedValue({ file_path: "photos/file_123.jpg" });
    const jpgBytes = Buffer.from([0xff, 0xd8]);
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(jpgBytes.buffer.slice(jpgBytes.byteOffset, jpgBytes.byteOffset + jpgBytes.byteLength)),
    });

    const result = await call({ file_id: "imgXYZ", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.file_name).toBe("file_123.jpg");
  });

  it("returns text contents for a small text file (txt extension)", async () => {
    mocks.getFile.mockResolvedValue({ file_path: "documents/notes.txt" });
    const content = "Hello, world!\nSecond line.";
    const txtBuf = Buffer.from(content, "utf-8");
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(txtBuf.buffer.slice(txtBuf.byteOffset, txtBuf.byteOffset + txtBuf.byteLength)),
    });

    const result = await call({ file_id: "txtID", file_name: "notes.txt", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.text).toBe(content);
  });

  it("returns text contents when mime_type is text/", async () => {
    mocks.getFile.mockResolvedValue({ file_path: "documents/data.bin" });
    const content = "col1,col2\n1,2";
    const csvBuf = Buffer.from(content, "utf-8");
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(csvBuf.buffer.slice(csvBuf.byteOffset, csvBuf.byteOffset + csvBuf.byteLength)),
    });

    const result = await call({ file_id: "csvID", file_name: "data.bin", mime_type: "text/csv", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.text).toBe(content);
  });

  it("omits text for files over 100 KB even if extension is .txt", async () => {
    mocks.getFile.mockResolvedValue({ file_path: "documents/big.txt" });
    const bigContent = "x".repeat(101 * 1024);
    const bigBuf = Buffer.from(bigContent, "utf-8");
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(bigBuf.buffer.slice(bigBuf.byteOffset, bigBuf.byteOffset + bigBuf.byteLength)),
    });

    const result = await call({ file_id: "bigTxt", file_name: "big.txt", token: 1123456});
    expect(isError(result)).toBe(false);
    const data = parseResult(result);
    expect(data.text).toBeUndefined();
  });

  it("returns error when BOT_TOKEN is missing", async () => {
    delete process.env.BOT_TOKEN;
    const result = await call({ file_id: "anyID", token: 1123456});
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.message).toMatch(/BOT_TOKEN/);
  });

  it("returns error when Telegram returns no file_path", async () => {
    mocks.getFile.mockResolvedValue({});
    const result = await call({ file_id: "noPath", token: 1123456});
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.message).toMatch(/file_path/);
  });

  it("returns error when download HTTP request fails", async () => {
    mocks.getFile.mockResolvedValue({ file_path: "documents/x.pdf" });
    fetchMock.mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" });
    const result = await call({ file_id: "failID", file_name: "x.pdf", token: 1123456});
    expect(isError(result)).toBe(true);
    const data = parseResult(result);
    expect(data.message).toMatch(/404/);
  });

describe("identity gate", () => {
  it("returns SID_REQUIRED when no identity provided", async () => {
    const result = await call({"file_id":"x"});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("SID_REQUIRED");
  });

  it("returns AUTH_FAILED when identity has wrong suffix", async () => {
    mocks.validateSession.mockReturnValueOnce(false);
    const result = await call({"file_id":"x","token": 1099999});
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("AUTH_FAILED");
  });

  it("proceeds when identity is valid", async () => {
    mocks.validateSession.mockReturnValueOnce(true);
    let code: string | undefined;
    try { code = errorCode(await call({"file_id":"x","token": 1099999})); } catch { /* gate passed, other error ok */ }
    expect(code).not.toBe("SID_REQUIRED");
    expect(code).not.toBe("AUTH_FAILED");
  });

});

});
