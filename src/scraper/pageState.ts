import type { BrowserContext, Page, Response } from "playwright";

export class RateLimitedError extends Error {
  public readonly code = "RATE_LIMITED";
  public retryAfter: number | undefined;

  public constructor(retryAfter?: number) {
    super("Creative Listing rate limited this execution; collection stopped.");
    this.name = "RateLimitedError";
    this.retryAfter = retryAfter;
  }
}

export class SourcePageError extends Error {
  public constructor(public readonly code: string) {
    super("Creative Listing returned an error page; collection cannot continue on this page.");
    this.name = "SourcePageError";
  }
}

export function parseRetryAfter(value: unknown, now = Date.now()): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  if (typeof value !== "string") return undefined;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
}

function errorPayload(text: string): { rateLimited: boolean; retryAfter?: number; error: boolean } {
  // Error responses are short standalone documents, not phrases inside seller descriptions.
  if (text.length > 4096) return { rateLimited: false, error: false };
  let value: unknown;
  try { value = JSON.parse(text); } catch { value = undefined; }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const message = [record.error, record.message, record.code].filter((part) => typeof part === "string").join(" ");
    const retryAfter = parseRetryAfter(record.retryAfter);
    return {
      rateLimited: /rate[ _-]?limit|too many requests/i.test(message),
      error: record.error !== undefined,
      ...(retryAfter === undefined ? {} : { retryAfter }),
    };
  }
  return { rateLimited: /^(?:too many requests|rate limit exceeded|429\b)/i.test(text.trim()), error: false };
}

/** One guard per execution, shared by all contexts/pages. Once limited, it never resets. */
export class SiteResponseGuard {
  private limited: RateLimitedError | undefined;
  private readonly statuses = new WeakMap<Page, number>();
  private readonly pending = new Set<Promise<void>>();

  public constructor(private readonly origin: string) {}

  public async install(context: BrowserContext): Promise<void> {
    await context.route("**/*", async (route) => {
      if (this.limited !== undefined) await route.abort();
      else await route.continue();
    });
    context.on("response", (response) => {
      if (new URL(response.url()).origin !== this.origin) return;
      const request = response.request();
      if (request.isNavigationRequest() && request.frame() === request.frame().page().mainFrame()) {
        this.statuses.set(request.frame().page(), response.status());
      }
      if (response.status() !== 429) return;
      // Latch immediately, before reading the body, so later requests are aborted.
      this.limited ??= new RateLimitedError(parseRetryAfter(response.headers()["retry-after"]));
      const pending = this.readRateLimit(response).finally(() => this.pending.delete(pending));
      this.pending.add(pending);
    });
  }

  private async readRateLimit(response: Response): Promise<void> {
    const text = await response.text().catch(() => "");
    const retryAfter = errorPayload(text).retryAfter;
    if (this.limited !== undefined && this.limited.retryAfter === undefined) this.limited.retryAfter = retryAfter;
  }

  public async check(page: Page): Promise<void> {
    await Promise.all(this.pending);
    if (this.limited !== undefined) throw this.limited;
    const content = await page.locator("body").innerText();
    const payload = errorPayload(content);
    if (payload.rateLimited) {
      this.limited = new RateLimitedError(payload.retryAfter);
      throw this.limited;
    }
    const status = this.statuses.get(page);
    if (status !== undefined && status >= 400) throw new SourcePageError(status === 404 ? "HTTP_404" : "HTTP_ERROR");
    const headings = await page.locator("h1, h2, [role=alert]").allTextContents();
    if (payload.error || headings.some((heading) => /^(?:404(?: page)? not found|page not found|something went wrong|internal server error|access denied|forbidden)\b/i.test(heading.trim()))) {
      throw new SourcePageError("ERROR_PAGE");
    }
  }

  public async assertNotRateLimited(): Promise<void> {
    await Promise.all(this.pending);
    if (this.limited !== undefined) throw this.limited;
  }
}
