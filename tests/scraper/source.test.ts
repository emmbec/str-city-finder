import { createServer, type Server } from "node:http";
import { chromium } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import type { StructuredLogger } from "../../src/logging/index.js";
import type { BrowserStorageState, CreativeListingScraperConfig, SessionStateStore } from "../../src/scraper/index.js";
import { CreativeListingSource } from "../../src/scraper/index.js";
import { installedChromiumExecutable } from "../helpers/browserExecutable.js";

const logger: StructuredLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };
let server: Server | undefined;

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
        response.end('<div data-testid="listing-grid"><a href="/deals/A1">A1</a></div><a rel="next" href="/listings?page=2">Next</a>');
      } else if (request.url === "/listings?page=2") {
        response.end('<div data-testid="listing-grid"><a href="/deals/A1">A1 duplicate</a><a href="/deals/B2">B2</a></div>');
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
    expect((await collect(first)).map((item) => item.sourceListingId)).toEqual(["A1", "B2"]);
    const second = new CreativeListingSource(config, credentials, state, logger, chromium);
    expect((await collect(second)).map((item) => item.sourceListingId)).toEqual(["A1", "B2"]);
    expect(loginPosts).toBe(1);
    expect(credentialReads).toBe(1);
  });
});

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
