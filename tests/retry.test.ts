import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../src/retry.js";

describe("withRetry", () => {
  it("returns the result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on matching status code and succeeds", async () => {
    const error = Object.assign(new Error("rate limited"), { statusCode: 429 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("recovered");

    const result = await withRetry(fn, {
      maxRetries: 3,
      initialDelay: 1,
      backoffMultiplier: 1,
      retryOnStatusCodes: [429],
    });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws immediately on non-retryable error", async () => {
    const error = new Error("bad request");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        initialDelay: 1,
        backoffMultiplier: 1,
        retryOnStatusCodes: [429],
      }),
    ).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting all retries", async () => {
    const error = Object.assign(new Error("rate limited"), { statusCode: 429 });
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        initialDelay: 1,
        backoffMultiplier: 1,
        retryOnStatusCodes: [429],
      }),
    ).rejects.toThrow("rate limited");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws on non-retryable status code without retrying", async () => {
    const error = Object.assign(new Error("server error"), { statusCode: 500 });
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(fn, {
        maxRetries: 3,
        initialDelay: 1,
        backoffMultiplier: 1,
        retryOnStatusCodes: [429],
      }),
    ).rejects.toThrow("server error");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses exponential backoff between retries", async () => {
    const error = Object.assign(new Error("rate limited"), { statusCode: 429 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok");

    const start = Date.now();
    await withRetry(fn, {
      maxRetries: 3,
      initialDelay: 10,
      backoffMultiplier: 2,
      retryOnStatusCodes: [429],
    });
    const elapsed = Date.now() - start;

    // initialDelay=10 + 10*2=20 = 30ms minimum
    expect(elapsed).toBeGreaterThanOrEqual(25);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses default config when none provided", async () => {
    const error = Object.assign(new Error("rate limited"), { statusCode: 429 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok");

    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
