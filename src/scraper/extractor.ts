import type { Locator, Page } from "playwright";
import type { RawListingSnapshot } from "../models/index.js";
import { CREATIVE_LISTING_SELECTORS, FIELD_ALIASES } from "./selectors.js";

export class ListingIdentityError extends Error {
  public constructor(url: string) {
    super(`Creative Listing detail page has no stable listing/deal identifier (${sanitizedUrl(url)}).`);
    this.name = "ListingIdentityError";
  }
}

export async function discoverListingUrls(page: Page, baseUrl: string): Promise<string[]> {
  const hrefs = await page.locator(CREATIVE_LISTING_SELECTORS.listingLinks.join(", ")).evaluateAll(
    (links) => links.map((element) => element instanceof HTMLAnchorElement ? element.href : ""),
  );
  const origin = new URL(baseUrl).origin;
  return [...new Set(hrefs.filter((href) => {
    try {
      const url = new URL(href);
      return url.origin === origin && /\/(?:listings?|deals?)\//i.test(url.pathname);
    } catch {
      return false;
    }
  }).map((href) => sanitizedUrl(href)))];
}

export async function extractRawListing(page: Page, capturedAt: string): Promise<RawListingSnapshot> {
  const rawPairs = await page.locator("body").evaluate((body) => {
    const clean = (value: string | null | undefined): string | undefined => {
      const result = value?.replace(/\s+/g, " ").trim();
      return result === undefined || result.length === 0 ? undefined : result;
    };
    const pairs: [string, string][] = [];
    const add = (label: string | null | undefined, value: string | null | undefined): void => {
      const cleanedLabel = clean(label);
      const cleanedValue = clean(value);
      if (cleanedLabel !== undefined && cleanedValue !== undefined && cleanedLabel !== cleanedValue) {
        pairs.push([cleanedLabel, cleanedValue]);
      }
    };

    for (const element of body.querySelectorAll<HTMLElement>("[data-field]")) {
      add(element.dataset.field, element.dataset.value ?? element.textContent);
    }
    for (const term of body.querySelectorAll("dt")) add(term.textContent, term.nextElementSibling?.textContent);
    for (const row of body.querySelectorAll("tr")) {
      const cells = row.querySelectorAll("th, td");
      if (cells.length >= 2) add(cells[0]?.textContent, cells[1]?.textContent);
    }
    for (const element of body.querySelectorAll<HTMLElement>("[aria-label][data-value]")) {
      add(element.getAttribute("aria-label"), element.dataset.value);
    }

    const schemaFields: readonly [string, string][] = [
      ["address", '[itemprop="streetAddress"]'], ["city", '[itemprop="addressLocality"]'],
      ["state", '[itemprop="addressRegion"]'], ["zipCode", '[itemprop="postalCode"]'],
      ["description", '[itemprop="description"]'], ["purchasePrice", '[itemprop="price"]'],
    ];
    for (const [name, selector] of schemaFields) {
      const element = body.querySelector<HTMLElement>(selector);
      add(name, element?.getAttribute("content") ?? element?.textContent);
    }
    return pairs;
  });

  const fields: Record<string, unknown> = {};
  const normalized = new Map<string, string>();
  for (const [label, value] of rawPairs) {
    const rawKey = `source.${label}`;
    if (fields[rawKey] === undefined) fields[rawKey] = value;
    normalized.set(normalizeLabel(label), value);
  }
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    const value = aliases.map((alias) => normalized.get(normalizeLabel(alias))).find((candidate) => candidate !== undefined);
    if (value !== undefined) fields[canonical] = value;
  }

  const sourceListingId = await findListingId(page);
  if (sourceListingId === undefined) throw new ListingIdentityError(page.url());
  return { sourceListingId, sourceUrl: sanitizedUrl(page.url()), capturedAt, fields };
}

export async function findNextPageControl(page: Page): Promise<Locator | undefined> {
  for (const selector of CREATIVE_LISTING_SELECTORS.nextPage) {
    const locator = page.locator(selector).first();
    if (await locator.count() === 0 || !(await locator.isVisible())) continue;
    const disabled = await locator.getAttribute("disabled") !== null
      || await locator.getAttribute("aria-disabled") === "true";
    if (!disabled) return locator;
  }
  return undefined;
}

async function findListingId(page: Page): Promise<string | undefined> {
  for (const selector of CREATIVE_LISTING_SELECTORS.listingId) {
    const element = page.locator(selector).first();
    if (await element.count() === 0) continue;
    const value = await element.getAttribute("data-listing-id")
      ?? await element.getAttribute("data-deal-id")
      ?? await element.textContent();
    const cleaned = value?.replace(/^(?:listing|deal)(?:\s+id)?\s*[:#-]?\s*/i, "").trim();
    if (cleaned !== undefined && cleaned.length > 0) return cleaned;
  }
  const match = /\/(?:listings?|deals?)\/([^/?#]+)/i.exec(new URL(page.url()).pathname);
  return match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, " ").trim();
}

export function sanitizedUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}
