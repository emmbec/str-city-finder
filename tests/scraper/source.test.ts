import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import type { StructuredLogger } from "../../src/logging/index.js";
import type { BrowserStorageState, CreativeListingScraperConfig, SessionStateStore } from "../../src/scraper/index.js";
import { CreativeListingSource, RateLimitedError } from "../../src/scraper/index.js";
import { installedChromiumExecutable } from "../helpers/browserExecutable.js";

const logger: StructuredLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };
let server: Server | undefined;
const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";

afterEach(async () => new Promise<void>((resolve, reject) => {
  if (server === undefined) { resolve(); return; }
  server.close((error) => { if (error === undefined) resolve(); else reject(error); });
  server = undefined;
}));

describe("CreativeListingSource", () => {
  it("logs in once, persists state, reuses it, and follows pagination until Next is absent", async () => {
    let loginPosts = 0;
    server = createServer((request, response) => {
      const authenticated = request.headers.cookie?.includes("session=valid") === true;
      if (request.url === "/login" && request.method === "POST") {
        loginPosts += 1;
        response.writeHead(302, { location: "/listings", "set-cookie": "session=valid; Path=/; HttpOnly" });
        response.end(); return;
      }
      if (!authenticated) {
        response.writeHead(200, { "content-type": "text/html" });
        response.end('<form method="post" action="/login"><input type="email"><input type="password"><button type="submit">Sign in</button></form>');
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      if (request.url === "/listings") {
        response.end(`${cards([A])}<a rel="next" href="/listings?page=2">Next</a>`);
      } else if (request.url === "/listings?page=2") {
        response.end(cards([A, B]));
      } else {
        const id = request.url?.split("/").at(-1) ?? "UNKNOWN";
        response.end(`<nav data-testid="account-menu">Account</nav><div data-deal-id="${id}"></div><dl><dt>City</dt><dd>Augusta</dd><dt>State</dt><dd>GA</dd></dl>`);
      }
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Test server did not bind.");
    const baseUrl = `http://127.0.0.1:${String(address.port)}/`;
    const state = new MemorySessionStore();
    let credentialReads = 0;
    const credentials = { getCredentials: () => { credentialReads += 1; return Promise.resolve({ username: "fixture@example.test", password: "fixture-password" }); } };
    const config: CreativeListingScraperConfig = {
      baseUrl, loginPath: "/login", listingsPath: "/listings", headless: true,
      navigationTimeoutMs: 5_000, selectorTimeoutMs: 2_000, retryAttempts: 2,
      retryDelayMs: 10, maximumPages: 10, diagnosticsDirectory: "test-results/creative-listing",
      captureTrace: false,
      browserExecutablePath: installedChromiumExecutable(),
    };

    const first = new CreativeListingSource(config, credentials, state, logger, chromium);
    expect((await collect(first)).map((item) => item.sourceListingId)).toEqual([A, B]);
    const second = new CreativeListingSource(config, credentials, state, logger, chromium);
    expect((await collect(second)).map((item) => item.sourceListingId)).toEqual([A, B]);
    expect(loginPosts).toBe(1);
    expect(credentialReads).toBe(1);
  }, 15_000);

  it.each(["404", "json-limit", "http-limit", "public", "empty-shell"])("never authenticates a %s response by pathname", async (kind) => {
    const notFound = await readFile("tests/fixtures/creative-listing/not-found.html", "utf8");
    const limited = await readFile("tests/fixtures/creative-listing/rate-limited.json", "utf8");
    const requests: string[] = [];
    server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(kind === "http-limit" ? 429 : 200, { "content-type": "text/html" });
      response.end(kind === "404" ? notFound : kind.includes("limit") ? limited : kind === "public"
        ? '<a href="/dashboard">Stale landmark</a><a href="/auth">Login</a><a href="/signup">Sign up</a><input type="password">'
        : "<body></body>");
    });
    const config = await serverConfig();
    let credentialReads = 0;
    const credentials = { getCredentials: () => { credentialReads++; return Promise.resolve({ username: "fixture", password: "fixture" }); } };
    const reused: string[] = [];
    const log: StructuredLogger = { ...logger, info: (entry) => { reused.push(entry.event); } };
    const source = new CreativeListingSource(config, credentials, new MemorySessionStore(), log);
    if (kind.includes("limit")) {
      await expect(collect(source)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfter: 300 });
      expect(requests).toEqual(["/listings"]);
    } else {
      await expect(collect(source)).rejects.toThrow();
    }
    expect(credentialReads).toBe(0);
    expect(reused).not.toContain("session_reused");
  });

  it("stops the execution on a rate-limited detail, retaining retryAfter without requesting the next listing", async () => {
    const requests: string[] = [];
    server = createServer((request, response) => {
      requests.push(request.url ?? "");
      if (request.url === "/listings") {
        response.writeHead(200, { "content-type": "text/html" }); response.end(cards([A, B]));
      } else {
        response.writeHead(429, { "content-type": "application/json", "retry-after": "300" });
        response.end('{"error":"Too many requests"}');
      }
    });
    const source = new CreativeListingSource(await serverConfig(), unusedCredentials, new MemorySessionStore(), logger);
    await expect(collect(source)).rejects.toBeInstanceOf(RateLimitedError);
    expect(requests).toEqual(["/listings", `/deals/${A}`]);
  });

  it.each(["disabled", "repeated", "no-new", "absent"])("stops pagination for %s without looping", async (mode) => {
    const requests: string[] = [];
    server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(200, { "content-type": "text/html" });
      if (request.url?.startsWith("/listings") === true) {
        const second = request.url.includes("page=2");
        response.end(cards(mode === "no-new" && second ? [A] : [A, B]) + (mode === "absent" ? "" : mode === "disabled"
          ? '<button disabled>Next</button>' : '<a rel="next" href="/listings?page=2">Next</a>'));
      } else response.end(detail());
    });
    const source = new CreativeListingSource(await serverConfig(), unusedCredentials, new MemorySessionStore(), logger);
    expect((await collect(source)).map((value) => value.sourceListingId)).toEqual([A, B]);
    expect(requests.filter((url) => url.startsWith("/listings"))).toHaveLength(mode === "disabled" || mode === "absent" ? 1 : 2);
  });

  it("does not click Next beyond the configured page ceiling", async () => {
    const requests: string[] = [];
    server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(200, { "content-type": "text/html" });
      response.end(request.url === "/listings" ? `${cards([A])}<a rel="next" href="/listings?page=2">Next</a>` : detail());
    });
    const source = new CreativeListingSource({ ...await serverConfig(), maximumPages: 1 }, unusedCredentials, new MemorySessionStore(), logger);
    expect(await collect(source)).toHaveLength(1);
    expect(requests).toEqual(["/listings", `/deals/${A}`]);
  });

  it("collects the observed H2 detail layout through the complete source pipeline", async () => {
    const fixture = await readFile("tests/fixtures/creative-listing/subject-to.html", "utf8");
    server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(request.url === "/listings" ? cards([A]) : fixture);
    });
    const source = new CreativeListingSource(await serverConfig(), unusedCredentials, new MemorySessionStore(), logger);
    const results = await collect(source);
    expect(results).toHaveLength(1);
    expect(results[0]?.fields).toMatchObject({ piti: "$2,256.21", bathrooms: "2.5", locationText: "Example City, AZ 85001" });
  });

  it.each([false, true])("does not report success after skipping a broken detail (other valid listing: %s)", async (includeValid) => {
    server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(request.url === "/listings" ? cards(includeValid ? [A, B] : [A])
        : request.url === `/deals/${A}` ? '<a href="/dashboard">Dashboard</a><main>Unrecognized detail structure</main>' : detail());
    });
    const source = new CreativeListingSource(await serverConfig(), unusedCredentials, new MemorySessionStore(), logger);
    const ids: string[] = [];
    const run = async () => { for await (const listing of source.collect("fixture-run")) ids.push(listing.sourceListingId); };
    await expect(run()).rejects.toMatchObject({ code: "INCOMPLETE_COLLECTION", failedListings: 1 });
    expect(ids).toEqual(includeValid ? [B] : []);
  });
});

function cards(ids: string[]): string {
  return '<nav><a href="/dashboard">Dashboard</a></nav>' + ids.map((id) => `<div id="deal-${id}"><h3>Example</h3></div>`).join("");
}

function detail(): string {
  return '<nav><a href="/dashboard">Dashboard</a></nav><h3>Listing Highlights</h3><div><p>Bedrooms</p><p>4</p></div>';
}

const unusedCredentials = { getCredentials: (): Promise<{ username: string; password: string }> => { throw new Error("Credentials should not be requested."); } };

async function serverConfig(): Promise<CreativeListingScraperConfig> {
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server?.address();
  if (address === undefined || address === null || typeof address === "string") throw new Error("Test server did not bind.");
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/`, loginPath: "/auth", listingsPath: "/listings", headless: true,
    navigationTimeoutMs: 2000, selectorTimeoutMs: 400, retryAttempts: 3, retryDelayMs: 10,
    maximumPages: 5, diagnosticsDirectory: "test-results/creative-listing", captureTrace: false,
    browserExecutablePath: installedChromiumExecutable(),
  };
}

class MemorySessionStore implements SessionStateStore {
  private value: BrowserStorageState | undefined;
  public load(): Promise<BrowserStorageState | undefined> { return Promise.resolve(this.value); }
  public save(state: BrowserStorageState): Promise<void> { this.value = state; return Promise.resolve(); }
}

async function collect(source: CreativeListingSource) {
  const results = [];
  for await (const result of source.collect("fixture-run")) results.push(result);
  return results;
}
