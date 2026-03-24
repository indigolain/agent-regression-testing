import type { RetryConfig } from "./types.js";

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 2000,
  backoffMultiplier: 2,
  retryOnStatusCodes: [429],
};

/**
 * Executes a function with retry logic and exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  const { maxRetries, initialDelay, backoffMultiplier, retryOnStatusCodes } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  let delay = initialDelay;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (
        statusCode !== undefined &&
        retryOnStatusCodes.includes(statusCode) &&
        attempt < maxRetries - 1
      ) {
        console.log(`Rate limited, retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= backoffMultiplier;
      } else {
        throw error;
      }
    }
  }

  // This should be unreachable, but TypeScript needs it
  throw new Error("withRetry: exhausted all retries");
}
