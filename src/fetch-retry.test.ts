import { vi, describe, it, expect, afterEach } from "vitest";
import { fetchWithRetry } from "./fetch-retry.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function spyFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl);
}

const makeResponse = (status = 200): Response =>
  ({ ok: status < 400, status, statusText: "" }) as Response;

describe("fetchWithRetry", () => {
  it("returns the response on first success (no retry)", async () => {
    const res = makeResponse();
    const fetchFn = spyFetch(async () => res);

    const out = await fetchWithRetry("https://api.telegram.org/file/x");

    expect(out).toBe(res);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries once then succeeds (default = 2 attempts)", async () => {
    const good = makeResponse();
    let n = 0;
    const fetchFn = spyFetch(async () => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return good;
    });

    const out = await fetchWithRetry("https://x/file");

    expect(out).toBe(good);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws the last error after all attempts fail (default 2 attempts)", async () => {
    const err = new TypeError("fetch failed");
    const fetchFn = spyFetch(async () => {
      throw err;
    });

    await expect(fetchWithRetry("https://x/file")).rejects.toBe(err);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry an HTTP-error response (4xx/5xx is returned, not thrown)", async () => {
    const res500 = makeResponse(500);
    const fetchFn = spyFetch(async () => res500);

    const out = await fetchWithRetry("https://x/file");

    expect(out).toBe(res500);
    expect(out.ok).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("uses a fresh AbortController (distinct signal) per attempt", async () => {
    const signals: (AbortSignal | null)[] = [];
    let n = 0;
    spyFetch(async (_url, init) => {
      signals.push(init?.signal ?? null);
      if (n++ === 0) throw new TypeError("transient");
      return makeResponse();
    });

    await fetchWithRetry("https://x/file");

    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("aborts an attempt at perAttemptTimeoutMs and surfaces the abort", async () => {
    // fetch settles only when its signal aborts — simulates a stalled download.
    const fetchFn = spyFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );

    await expect(
      fetchWithRetry("https://x/file", undefined, { attempts: 1, perAttemptTimeoutMs: 30 }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("honors a custom attempts count", async () => {
    const fetchFn = spyFetch(async () => {
      throw new TypeError("x");
    });

    await expect(
      fetchWithRetry("https://x/file", undefined, { attempts: 3 }),
    ).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("passes caller init through while injecting the abort signal", async () => {
    const fetchFn = spyFetch(async () => makeResponse());

    await fetchWithRetry("https://x/file", { headers: { "x-test": "1" } });

    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ "x-test": "1" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("clears the per-attempt timer on success (no late abort fires)", async () => {
    let captured: AbortSignal | undefined;
    const fetchFn = spyFetch(async (_url, init) => {
      captured = init?.signal ?? undefined;
      return makeResponse();
    });

    await fetchWithRetry("https://x/file", undefined, { perAttemptTimeoutMs: 20 });
    // Wait past the timeout window: if clearTimeout failed, abort would fire late.
    await new Promise((r) => setTimeout(r, 45));

    expect(captured?.aborted).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
