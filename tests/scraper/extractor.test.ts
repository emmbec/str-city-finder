import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { discoverListingUrls, extractRawListing, sanitizedUrl } from "../../src/scraper/index.js";
import { installedChromiumExecutable } from "../helpers/browserExecutable.js";

const browser = await chromium.launch({ headless: true, executablePath: installedChromiumExecutable() });

afterAll(async () => browser.close());

describe("Creative Listing fixture extraction", () => {
  it("extracts canonical fields and preserves every source label/value", async () => {
    const fixture = await readFile("tests/fixtures/creative-listing/detail.html", "utf8");
    const page = await browser.newPage();
    await page.route("https://www.creativelisting.com/deals/CL-100*", (route) => route.fulfill({ body: fixture, contentType: "text/html" }));
    await page.goto("https://www.creativelisting.com/deals/CL-100?access_token=secret#private");
    const result = await extractRawListing(page, "2026-09-09T10:00:00.000Z");

    expect(result.sourceListingId).toBe("CL-100");
    expect(result.sourceUrl).toBe("https://www.creativelisting.com/deals/CL-100");
    expect(result.fields).toEqual(expect.objectContaining({
      address: "123 Main St", city: "Augusta", state: "GA", zipCode: "30901",
      purchasePrice: "$250,000", entryFee: "$35,000", loanBalance: "$215,000",
      interestRate: "4.5%", piti: "$2,200 / month", hoa: "$125", beds: "3 beds",
      bathrooms: "2.5 baths", squareFeet: "1,850", yearBuilt: "1998",
      financingType: "Seller Financing", occupancyStatus: "Vacant", sourceStatus: "Active",
      sourcePostedAt: "2026-09-08", balloonPayment: "Due in 7 years",
      "source.Purchase Price": "$250,000", "source.Balloon Payment": "Due in 7 years",
    }));
    await page.close();
  });

  it("discovers only same-origin listing and deal detail links", async () => {
    const page = await browser.newPage();
    await page.setContent(`
      <div data-testid="listing-card"><a href="https://www.creativelisting.com/listings/1">One</a></div>
      <a href="https://www.creativelisting.com/deals/2">Two</a>
      <a href="https://other.test/deals/3">External</a>
    `);
    await expect(discoverListingUrls(page, "https://www.creativelisting.com/")).resolves.toEqual([
      "https://www.creativelisting.com/listings/1", "https://www.creativelisting.com/deals/2",
    ]);
    await page.close();
  });

  it("removes credentials, query strings, and fragments from diagnostic URLs", () => {
    expect(sanitizedUrl("https://user:pass@example.test/deals/1?token=x#secret")).toBe("https://example.test/deals/1");
  });
});
