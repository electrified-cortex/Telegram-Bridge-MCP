import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMockServer, parseResult, isError, errorCode } from "./test-utils.js";

const mocks = vi.hoisted(() => ({ sendDocument: vi.fn() }));

vi.mock("../telegram.js", async (importActual) => {
  const actual = await importActual<typeof import("../telegram.js")>();
  return { ...actual, getApi: () => mocks, resolveChat: () => "1" };
});

vi.mock("fs", async (importActual) => {
  const actual = await importActual<typeof import("fs")>();
  return { ...actual, existsSync: (p: string) => p === "/tmp/test.pdf" };
});

vi.mock("grammy", async (importActual) => {
  const actual = await importActual<typeof import("grammy")>();
  return {
    ...actual,
    InputFile: class MockInputFile {
      path: string;
      constructor(path: string) { this.path = path; }
    },
  };
});

import { register } from "./send_document.js";

describe("send_document tool", () => {
  let call: (args: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    const server = createMockServer();
    register(server as any);
    call = server.getHandler("send_document");
  });

  it("sends a document by URL and returns metadata", async () => {
    mocks.sendDocument.mockResolvedValue({
      message_id: 10,
      document: { file_id: "abc123", file_name: "report.pdf", mime_type: "application/pdf", file_size: 12345 },
    });
    const result = await call({ document: "https://example.com/report.pdf" });
    expect(isError(result)).toBe(false);
    const data = parseResult(result) as any;
    expect(data.message_id).toBe(10);
    expect(data.file_name).toBe("report.pdf");
    expect(data.mime_type).toBe("application/pdf");
  });

  it("sends a local file using InputFile", async () => {
    mocks.sendDocument.mockResolvedValue({
      message_id: 11,
      document: { file_id: "local123", file_name: "test.pdf", mime_type: "application/pdf", file_size: 5000 },
    });
    const result = await call({ document: "/tmp/test.pdf" });
    expect(isError(result)).toBe(false);
    const [, docArg] = mocks.sendDocument.mock.calls[0];
    expect(docArg).toHaveProperty("path", "/tmp/test.pdf");
  });

  it("sends by file_id when not a path or URL", async () => {
    mocks.sendDocument.mockResolvedValue({
      message_id: 12,
      document: { file_id: "fid456", file_name: "data.zip", mime_type: "application/zip", file_size: 9999 },
    });
    const result = await call({ document: "fid456" });
    expect(isError(result)).toBe(false);
    const [, docArg] = mocks.sendDocument.mock.calls[0];
    expect(docArg).toBe("fid456");
  });

  it("validates caption length pre-send", async () => {
    const result = await call({ document: "fid456", caption: "c".repeat(1025) });
    expect(isError(result)).toBe(true);
    expect(errorCode(result)).toBe("CAPTION_TOO_LONG");
    expect(mocks.sendDocument).not.toHaveBeenCalled();
  });

  it("passes caption and reply_to_message_id to API", async () => {
    mocks.sendDocument.mockResolvedValue({ message_id: 13, document: { file_id: "x" } });
    await call({ document: "https://x.com/f.zip", caption: "Here you go", reply_to_message_id: 5 });
    const [, , opts] = mocks.sendDocument.mock.calls[0];
    expect(opts.reply_parameters).toEqual({ message_id: 5 });
  });
});
