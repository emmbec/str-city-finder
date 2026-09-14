import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { afterAll, describe, expect, it } from "vitest";
import { discoverListingUrls, extractRawListing, listingIdFromUrl, listingPageSignature, sanitizedUrl } from "../../src/scraper/index.js";
import { DefaultListingNormalizer } from "../../src/normalization/index.js";
import { installedChromiumExecutable } from "../helpers/browserExecutable.js";

const browser = await chromium.launch({ headless: true, executablePath: installedChromiumExecutable() });

afterAll(async () => browser.close());

describe("Creative Listing fixture extraction", () => {
  it("extracts canonical fields and preserves every source label/value", async () => {
    const fixture = await readFile("tests/fixtures/creative-listing/detail.html", "utf8");
    const page = await browser.newPage();
    await page.route("https://www.creativelisting.com/**", (route) => route.fulfill({ body: fixture, contentType: "text/html" }));
    await page.goto("https://www.creativelisting.com/deals/10000000-0000-4000-8000-000000000001?access_token=secret#private");
    const result = await extractRawListing(page, "2026-09-09T10:00:00.000Z");

    expect(result.sourceListingId).toBe("10000000-0000-4000-8000-000000000001");
    expect(result.sourceUrl).toBe("https://www.creativelisting.com/deals/10000000-0000-4000-8000-000000000001");
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

  it("discovers and deduplicates UUID cards without anchors and excludes creation routes", async () => {
    const page = await browser.newPage();
    await page.setContent(await readFile("tests/fixtures/creative-listing/cards.html", "utf8"));
    await expect(discoverListingUrls(page, "https://www.creativelisting.com/")).resolves.toEqual([
      "https://www.creativelisting.com/deals/10000000-0000-4000-8000-000000000001",
      "https://www.creativelisting.com/deals/10000000-0000-4000-8000-000000000002",
    ]);
    await page.close();
  });

  it.each(["new", "CL-100", "123", "10000000-0000-4000-8000-000000000001/edit"])("rejects non-detail identity %s", (path) => {
    expect(listingIdFromUrl(`https://example.test/deals/${path}`)).toBeUndefined();
  });

  it("uses UUID sets, independent of ordering or query strings, for page signatures", () => {
    const first = "https://example.test/deals/10000000-0000-4000-8000-000000000001";
    const second = "https://example.test/deals/10000000-0000-4000-8000-000000000002";
    expect(listingPageSignature([first, second])).toBe(listingPageSignature([`${second}?page=2`, first, first]));
    expect(listingPageSignature([first])).not.toBe(listingPageSignature([second]));
  });

  it("extracts rendered Subject-To labels and preserves conflicting seller prose verbatim", async () => {
    const { raw, normalized } = await fixtureResult("subject-to");
    expect(raw.fields).toMatchObject({
      beds: "4", bathrooms: "2.5", squareFeet: "2,300", lotSize: "0.17 acres", pricePerSquareFoot: "$164.79",
      propertyType: "Single Family Home", yearBuilt: "2000", parking: "1-car garage", hoa: "$118.66/month",
      loanType: "FHA", interestRate: "6.75%", loanBalance: "$379,024.69", piti: "$2,256.21",
      loanMaturityDate: "Oct 10, 2066", purchasePrice: "$379,024.69", downPayment: "$35,000",
      monthlyPayment: "$2,256.21", earnestMoneyDeposit: "$5,000", expectedCloseOfEscrow: "2026-09-21",
      sourcePostedAt: "September 10, 2026",
    });
    const description = "Seller notes retain their original formatting.\n\nInterest Rate: 6.875% (goes down to 6.75% later).\nMonthly Payment: $2,256.21 (goes down to $2,169.23 later).\n  This indentation is source text.";
    expect(raw.fields.description).toBe(description);
    expect(raw.fields["source.About this Listing"]).toBe(description);
    expect(normalized).toMatchObject({ beds: 4, fullBaths: 2, halfBaths: 1, squareFeet: 2300, city: "Example City", state: "AZ", zipCode: "85001", financingType: "SUBJECT_TO", sourceStatus: "ACTIVE" });
    expect(normalized.financials).toMatchObject({ piti: 2256.21, monthlyPayment: 2256.21, interestRate: 6.75, hoa: 118.66 });
    expect(normalized.rawFields).toEqual(raw.fields);
  });

  it("keeps absent financing and optional details absent on a cash listing", async () => {
    const { raw, normalized } = await fixtureResult("cash");
    expect(raw.fields.address).toBe("Address undisclosed");
    expect(normalized.address).toBeUndefined();
    expect(normalized.financingType).toBe("CASH");
    expect(normalized.squareFeet).toBe(982);
    expect(normalized.description).toContain("992 sqft");
    for (const field of ["piti", "monthlyPayment", "loanBalance", "interestRate", "downPayment", "hoa", "yearBuilt", "parking"]) expect(raw.fields[field]).toBeUndefined();
    expect(normalized.financials).toEqual({ currency: "USD", purchasePrice: 139000 });
  });

  it("preserves lease-option terms without reinterpreting the option fee as a down payment", async () => {
    const { raw, normalized } = await fixtureResult("lease-option");
    expect(raw.fields).toMatchObject({ optionFee: "$39,500", optionSalePrice: "$355,500", optionTerm: "2 Years", monthlyLeasePayment: "$2,800/month", monthlyPayment: "$2,800" });
    expect(raw.fields.downPayment).toBeUndefined();
    expect(raw.fields.piti).toBeUndefined();
    expect(normalized.financials.monthlyPayment).toBe(2800);
    expect(normalized.financingType).toBe("OTHER");
  });

  it("retains explicitly zero payments while leaving unspecified loan terms missing", async () => {
    const { raw, normalized } = await fixtureResult("zero-payments");
    expect(raw.fields).toMatchObject({ downPayment: "$0", monthlyPayment: "$0" });
    expect(normalized.financials).toMatchObject({ downPayment: 0, monthlyPayment: 0 });
    expect(normalized.financingType).toBe("UNKNOWN");
    expect(normalized.financials.piti).toBeUndefined();
  });

  it("surfaces empty extraction as insufficient data, not HIGH confidence", async () => {
    const { raw, normalized } = await fixtureResult("empty");
    expect(raw.fields).toEqual({});
    expect(normalized.confidence).toBe("LOW");
    expect(normalized.parsingIssues).toContainEqual(expect.objectContaining({ code: "INSUFFICIENT_EXTRACTED_DATA" }));
  });

  it("removes credentials, query strings, and fragments from diagnostic URLs", () => {
    expect(sanitizedUrl("https://user:pass@example.test/deals/1?token=x#secret")).toBe("https://example.test/deals/1");
  });
});

async function fixtureResult(name: string) {
  const page = await browser.newPage();
  try {
    const body = await readFile(`tests/fixtures/creative-listing/${name}.html`, "utf8");
    await page.route("https://example.test/**", (route) => route.fulfill({ body, contentType: "text/html" }));
    await page.goto("https://example.test/deals/10000000-0000-4000-8000-000000000001");
    const raw = await extractRawListing(page, "2026-09-11T12:00:00.000Z");
    return { raw, normalized: new DefaultListingNormalizer().normalize(raw) };
  } finally { await page.close(); }
}
