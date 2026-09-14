import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type BrowserType, type Locator, type Page } from "playwright";
import type { StructuredLogger } from "../logging/index.js";
import type { RawListingSnapshot } from "../models/index.js";
import { discoverListingUrls, extractRawListing, findNextPageControl, listingPageSignature, sanitizedUrl } from "./extractor.js";
import { RateLimitedError, SiteResponseGuard, SourcePageError } from "./pageState.js";
import { withTransientRetry } from "./retry.js";
import { CREATIVE_LISTING_SELECTORS } from "./selectors.js";
import { captureStorageState, type SessionStateStore } from "./sessionState.js";
import type { CredentialProvider, ListingSource } from "./types.js";

export interface CreativeListingScraperConfig {
  baseUrl: string;
  loginPath: string;
  listingsPath: string;
  headless: boolean;
  navigationTimeoutMs: number;
  selectorTimeoutMs: number;
  retryAttempts: number;
  retryDelayMs: number;
  maximumPages: number;
  diagnosticsDirectory: string;
  captureTrace: boolean;
  browserExecutablePath?: string;
}

export class AuthenticationBarrierError extends Error {
  public constructor() {
    super("Creative Listing requires CAPTCHA, MFA, or another interactive access step; unattended authentication stopped.");
    this.name = "AuthenticationBarrierError";
  }
}

export class AuthenticationError extends Error {
  public constructor(message = "Creative Listing authentication did not produce a valid session.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class CollectionIncompleteError extends Error {
  public readonly code = "INCOMPLETE_COLLECTION";

  public constructor(public readonly failedListings: number) {
    super("One or more listing detail pages could not be collected; this execution is incomplete.");
    this.name = "CollectionIncompleteError";
  }
}

export class CreativeListingSource implements ListingSource {
  public constructor(
    private readonly config: CreativeListingScraperConfig,
    private readonly credentialProvider: CredentialProvider,
    private readonly sessionStore: SessionStateStore,
    private readonly logger: StructuredLogger,
    private readonly browserType: BrowserType = chromium,
  ) {}

  public async *collect(runId: string): AsyncIterable<RawListingSnapshot> {
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    let traceStarted = false;
    let failedListings = 0;
    const guard = new SiteResponseGuard(new URL(this.config.baseUrl).origin);
    try {
      browser = await this.browserType.launch({
        headless: this.config.headless,
        ...(this.config.browserExecutablePath === undefined ? {} : { executablePath: this.config.browserExecutablePath }),
      });
      const savedState = await this.loadSessionState(runId);
      context = await browser.newContext({ serviceWorkers: "block", ...(savedState === undefined ? {} : { storageState: savedState }) });
      await guard.install(context);
      page = await context.newPage();
      page.setDefaultTimeout(this.config.selectorTimeoutMs);

      await this.navigate(page, this.listingsUrl(), runId, "session_validation", guard);
      if (!(await this.isAuthenticated(page, guard))) {
        this.logger.info({ runId, stage: "authentication", event: "session_refresh_required" });
        await context.close();
        context = await browser.newContext({ serviceWorkers: "block" });
        await guard.install(context);
        page = await context.newPage();
        page.setDefaultTimeout(this.config.selectorTimeoutMs);
        await this.login(page, runId, guard);
        await this.sessionStore.save(await captureStorageState(context));
        this.logger.info({ runId, stage: "authentication", event: "session_state_refreshed", status: "success" });
        await this.navigate(page, this.listingsUrl(), runId, "listing_discovery", guard);
      } else {
        this.logger.info({ runId, stage: "authentication", event: "session_reused", status: "success" });
      }

      if (this.config.captureTrace) {
        await context.tracing.start({ screenshots: true, snapshots: false, sources: false });
        traceStarted = true;
      }
      const detailPage = await context.newPage();
      detailPage.setDefaultTimeout(this.config.selectorTimeoutMs);
      const seenUrls = new Set<string>();
      const seenPageSignatures = new Set<string>();

      for (let pageNumber = 1; pageNumber <= this.config.maximumPages; pageNumber += 1) {
        const listingUrls = await this.discoverWithRetry(page, runId, pageNumber, guard);
        const signature = listingPageSignature(listingUrls);
        if (seenPageSignatures.has(signature) || !listingUrls.some((url) => !seenUrls.has(url))) {
          this.logger.info({ runId, stage: "extraction", event: "pagination_stopped", reason: "NO_NEW_UUIDS", pageNumber });
          break;
        }
        seenPageSignatures.add(signature);
        this.logger.info({ runId, stage: "extraction", event: "discovery_page_collected", pageNumber, listingsFound: listingUrls.length });

        for (const url of listingUrls) {
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);
          try {
            await this.navigate(detailPage, url, runId, "listing_detail", guard);
            if (!(await this.isAuthenticated(detailPage, guard))) throw new AuthenticationError("Creative Listing session expired during collection.");
            await this.waitForRendered(detailPage, guard, async () => await hasAnyVisible(detailPage, [CREATIVE_LISTING_SELECTORS.detailReady]));
            yield await extractRawListing(detailPage, new Date().toISOString());
          } catch (error) {
            await guard.assertNotRateLimited();
            if (error instanceof AuthenticationError || error instanceof AuthenticationBarrierError || error instanceof RateLimitedError) throw error;
            failedListings += 1;
            await this.captureFailure(detailPage, runId, "listing-detail");
            this.logger.error({
              runId,
              stage: "extraction",
              event: "listing_extraction_failed",
              status: "error",
              page: sanitizedUrl(detailPage.url()),
              errorCode: error instanceof SourcePageError ? error.code : error instanceof Error ? error.name : "UnknownError",
            }, "A listing was skipped after extraction failed.");
          }
        }

        if (pageNumber >= this.config.maximumPages) break;
        await guard.check(page);
        const next = await findNextPageControl(page);
        if (next === undefined) break;
        if (!(await this.advancePage(page, next, signature, guard))) {
          this.logger.info({ runId, stage: "navigation", event: "pagination_stopped", reason: "REPEATED_UUIDS", pageNumber });
          break;
        }
      }
      await detailPage.close();
      if (failedListings > 0) throw new CollectionIncompleteError(failedListings);
    } catch (error) {
      // A background 429 can abort a click before its normal guard check.
      const failure: unknown = await guard.assertNotRateLimited().then(() => error, (rateError: unknown) => rateError);
      if (failure instanceof RateLimitedError) {
        this.logger.error({ runId, stage: "navigation", event: "scraper_rate_limited", errorCode: failure.code, retryAfter: failure.retryAfter });
        throw failure;
      }
      if (context !== undefined && traceStarted) {
        await this.captureTrace(context, runId);
        traceStarted = false;
      }
      if (page !== undefined && !page.isClosed()) await this.captureFailure(page, runId, "scraper");
      throw error;
    } finally {
      if (context !== undefined && traceStarted) await context.tracing.stop().catch(() => undefined);
      await browser?.close();
    }
  }

  private async login(page: Page, runId: string, guard: SiteResponseGuard): Promise<void> {
    await this.navigate(page, new URL(this.config.loginPath, this.config.baseUrl).toString(), runId, "login_page", guard);
    await this.waitForRendered(page, guard, async () => await hasAnyVisible(page, CREATIVE_LISTING_SELECTORS.password));
    if (await hasAnyVisible(page, CREATIVE_LISTING_SELECTORS.accessBarrier)) throw new AuthenticationBarrierError();
    const username = await visibleLocator(page.getByLabel(/email|username/i).first())
      ?? await firstVisible(page, CREATIVE_LISTING_SELECTORS.username);
    const password = await visibleLocator(page.getByLabel(/password/i).first())
      ?? await firstVisible(page, CREATIVE_LISTING_SELECTORS.password);
    const submit = await visibleLocator(page.getByRole("button", { name: /sign in|log in|login/i }).first())
      ?? await firstVisible(page, CREATIVE_LISTING_SELECTORS.loginSubmit);
    if (username === undefined || password === undefined || submit === undefined) {
      throw new AuthenticationError("Creative Listing login controls could not be located.");
    }
    const credentials = await this.credentialProvider.getCredentials();
    await guard.check(page);
    await username.fill(credentials.username);
    await password.fill(credentials.password);
    await submit.click();
    if (await hasAnyVisible(page, CREATIVE_LISTING_SELECTORS.accessBarrier)) throw new AuthenticationBarrierError();
    if (!(await this.isAuthenticated(page, guard, true))) {
      throw new AuthenticationError(`Creative Listing authentication did not produce a valid session (${sanitizedUrl(page.url())}).`);
    }
  }

  private async isAuthenticated(page: Page, guard: SiteResponseGuard, afterLogin = false): Promise<boolean> {
    const deadline = Date.now() + this.config.selectorTimeoutMs;
    do {
      await guard.check(page);
      if (await hasAnyVisible(page, CREATIVE_LISTING_SELECTORS.accessBarrier)) throw new AuthenticationBarrierError();
      const passwordVisible = await hasAnyVisible(page, CREATIVE_LISTING_SELECTORS.password);
      const publicPage = passwordVisible || await hasAnyVisible(page, CREATIVE_LISTING_SELECTORS.publicNavigation)
        || /\/(?:auth|signup)(?:\/|$)/i.test(new URL(page.url()).pathname);
      if (!publicPage && await hasAnyVisible(page, CREATIVE_LISTING_SELECTORS.authenticated)) return true;
      if (passwordVisible && !afterLogin) return false;
      await page.waitForTimeout(100);
    } while (Date.now() < deadline);
    return false;
  }

  private async navigate(page: Page, url: string, runId: string, event: string, guard: SiteResponseGuard): Promise<void> {
    await withTransientRetry(async () => {
      await guard.assertNotRateLimited();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: this.config.navigationTimeoutMs });
      } catch (error) {
        await guard.assertNotRateLimited();
        throw error;
      }
      await guard.check(page);
    }, {
      attempts: this.config.retryAttempts,
      delayMs: this.config.retryDelayMs,
      onRetry: (attempt, error) => {
        this.logger.warn({ runId, stage: "navigation", event: `${event}_retry`, retryAttempt: attempt, errorCode: error.name });
      },
    });
  }

  private async discoverWithRetry(page: Page, runId: string, pageNumber: number, guard: SiteResponseGuard): Promise<string[]> {
    return withTransientRetry(async () => {
      await this.waitForRendered(page, guard, async () => await hasAnyVisible(page, [
        ...CREATIVE_LISTING_SELECTORS.listingContainer, ...CREATIVE_LISTING_SELECTORS.emptyListings,
      ]));
      if (!(await this.isAuthenticated(page, guard))) throw new AuthenticationError();
      const urls = await discoverListingUrls(page, this.config.baseUrl);
      if (urls.length === 0 && !(await hasAnyVisible(page, CREATIVE_LISTING_SELECTORS.emptyListings))) {
        throw new SourcePageError("NO_VALID_LISTING_UUIDS");
      }
      return urls;
    }, {
      attempts: this.config.retryAttempts,
      delayMs: this.config.retryDelayMs,
      onRetry: (attempt, error) => {
        this.logger.warn({ runId, stage: "extraction", event: "listing_selector_retry", retryAttempt: attempt, pageNumber, errorCode: error.name });
      },
    });
  }

  private async advancePage(page: Page, next: Locator, before: string, guard: SiteResponseGuard): Promise<boolean> {
    await guard.check(page);
    await next.click();
    // Never retry a Next click: a slow response could otherwise skip a page.
    const deadline = Date.now() + this.config.selectorTimeoutMs;
    while (Date.now() < deadline) {
      await guard.check(page);
      if (await hasAnyVisible(page, CREATIVE_LISTING_SELECTORS.accessBarrier)) throw new AuthenticationBarrierError();
      if (await hasAnyVisible(page, CREATIVE_LISTING_SELECTORS.password)) throw new AuthenticationError();
      const urls = await discoverListingUrls(page, this.config.baseUrl);
      if (urls.length > 0 && listingPageSignature(urls) !== before) return true;
      if (await hasAnyVisible(page, CREATIVE_LISTING_SELECTORS.emptyListings)) return true;
      await page.waitForTimeout(100);
    }
    return false;
  }

  private async waitForRendered(page: Page, guard: SiteResponseGuard, ready: () => Promise<boolean>): Promise<void> {
    const deadline = Date.now() + this.config.selectorTimeoutMs;
    do {
      await guard.check(page);
      if (await hasAnyVisible(page, CREATIVE_LISTING_SELECTORS.accessBarrier)) throw new AuthenticationBarrierError();
      if (await ready()) return;
      await page.waitForTimeout(100);
    } while (Date.now() < deadline);
    throw new SourcePageError("RENDERED_CONTENT_MISSING");
  }

  private async loadSessionState(runId: string): Promise<Awaited<ReturnType<SessionStateStore["load"]>>> {
    try {
      return await this.sessionStore.load();
    } catch (error) {
      this.logger.warn({ runId, stage: "authentication", event: "session_state_unreadable", errorCode: error instanceof Error ? error.name : "UnknownError" });
      return undefined;
    }
  }

  private async captureFailure(page: Page, runId: string, label: string): Promise<void> {
    try {
      await mkdir(this.config.diagnosticsDirectory, { recursive: true });
      const safeRunId = runId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
      const path = join(this.config.diagnosticsDirectory, `${safeRunId}-${label}-${String(Date.now())}.png`);
      await page.screenshot({ path, fullPage: true, mask: [page.locator("input, textarea, [contenteditable=true]")] });
      this.logger.warn({ runId, stage: "extraction", event: "sanitized_screenshot_captured", page: sanitizedUrl(page.url()), diagnosticArtifact: path });
    } catch {
      this.logger.warn({ runId, stage: "extraction", event: "diagnostic_capture_failed" });
    }
  }

  private async captureTrace(context: BrowserContext, runId: string): Promise<void> {
    try {
      await mkdir(this.config.diagnosticsDirectory, { recursive: true });
      const safeRunId = runId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
      const path = join(this.config.diagnosticsDirectory, `${safeRunId}-scraper-${String(Date.now())}.trace.zip`);
      await context.tracing.stop({ path });
      this.logger.warn({ runId, stage: "extraction", event: "post_auth_trace_captured", diagnosticArtifact: path });
    } catch {
      this.logger.warn({ runId, stage: "extraction", event: "trace_capture_failed" });
    }
  }

  private listingsUrl(): string {
    return new URL(this.config.listingsPath, this.config.baseUrl).toString();
  }
}

async function firstVisible(page: Page, selectors: readonly string[]): Promise<Locator | undefined> {
  for (const selector of selectors) {
    const locator = await visibleLocator(page.locator(selector).first());
    if (locator !== undefined) return locator;
  }
  return undefined;
}

async function visibleLocator(locator: Locator): Promise<Locator | undefined> {
  return await locator.count() > 0 && await locator.isVisible() ? locator : undefined;
}

async function hasAnyVisible(page: Page, selectors: readonly string[]): Promise<boolean> {
  return await firstVisible(page, selectors) !== undefined;
}

export function loadCreativeListingScraperConfig(environment: NodeJS.ProcessEnv = process.env): CreativeListingScraperConfig {
  return {
    baseUrl: environment.CREATIVE_LISTING_BASE_URL ?? "https://www.creativelisting.com/",
    loginPath: environment.CREATIVE_LISTING_LOGIN_PATH ?? "/auth",
    listingsPath: environment.CREATIVE_LISTING_LISTINGS_PATH ?? "/deals?view=list",
    headless: environment.CREATIVE_LISTING_HEADLESS !== "false",
    navigationTimeoutMs: positiveInteger(environment.CREATIVE_LISTING_NAVIGATION_TIMEOUT_MS, 30_000),
    selectorTimeoutMs: positiveInteger(environment.CREATIVE_LISTING_SELECTOR_TIMEOUT_MS, 10_000),
    retryAttempts: positiveInteger(environment.CREATIVE_LISTING_RETRY_ATTEMPTS, 3),
    retryDelayMs: positiveInteger(environment.CREATIVE_LISTING_RETRY_DELAY_MS, 500),
    maximumPages: positiveInteger(environment.CREATIVE_LISTING_MAXIMUM_PAGES, 500),
    diagnosticsDirectory: environment.CREATIVE_LISTING_DIAGNOSTICS_DIR ?? "test-results/creative-listing",
    captureTrace: environment.CREATIVE_LISTING_CAPTURE_TRACE === "true",
    ...(environment.CREATIVE_LISTING_BROWSER_EXECUTABLE_PATH === undefined
      ? {}
      : { browserExecutablePath: environment.CREATIVE_LISTING_BROWSER_EXECUTABLE_PATH }),
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const result = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`Expected a positive integer scraper setting, received '${value}'.`);
  return result;
}
