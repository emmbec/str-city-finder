import { errors } from "playwright";

export interface RetryOptions {
  attempts: number;
  delayMs: number;
  onRetry?: (attempt: number, error: Error) => void;
}

export async function withTransientRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error("Unknown browser failure");
      lastError = normalized;
      if (attempt >= options.attempts || !isTransientBrowserError(normalized)) throw normalized;
      options.onRetry?.(attempt, normalized);
      await new Promise<void>((resolve) => setTimeout(resolve, options.delayMs * attempt));
    }
  }
  throw lastError ?? new Error("Browser operation failed without an error.");
}

export function isTransientBrowserError(error: Error): boolean {
  return error instanceof errors.TimeoutError
    || /(?:ERR_|timeout|timed out|temporar|navigation|Target page, context or browser has been closed)/i.test(error.message);
}
