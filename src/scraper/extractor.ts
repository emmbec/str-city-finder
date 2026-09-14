import type { Locator, Page } from "playwright";
import type { RawListingSnapshot } from "../models/index.js";
import { CREATIVE_LISTING_SELECTORS, FIELD_ALIASES } from "./selectors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ListingIdentityError extends Error {
  public constructor(url: string) {
    super(`Creative Listing detail page has no stable UUID (${sanitizedUrl(url)}).`);
    this.name = "ListingIdentityError";
  }
}

export function listingIdFromUrl(value: string): string | undefined {
  const match = /^\/deals\/([^/]+)\/?$/.exec(new URL(value).pathname);
  return match?.[1] !== undefined && UUID.test(match[1]) ? match[1].toLowerCase() : undefined;
}

export async function discoverListingUrls(page: Page, baseUrl: string): Promise<string[]> {
  const ids = await page.locator(CREATIVE_LISTING_SELECTORS.listingCards).evaluateAll(
    (cards) => cards.map((card) => card.id.slice("deal-".length)),
  );
  return [...new Set(ids.filter((id) => UUID.test(id)).map((id) => id.toLowerCase()))]
    .map((id) => new URL(`/deals/${id}`, baseUrl).toString());
}

export function listingPageSignature(urls: readonly string[]): string {
  return [...new Set(urls.map(listingIdFromUrl).filter((id) => id !== undefined))].sort().join("|");
}

export async function extractRawListing(page: Page, capturedAt: string): Promise<RawListingSnapshot> {
  const sourceListingId = listingIdFromUrl(page.url());
  if (sourceListingId === undefined) throw new ListingIdentityError(page.url());
  const rawPairs = await page.locator("body").evaluate((body, options) => {
    const key = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const known = new Set(options.labels.map(key));
    const pairs: [string, string][] = [];
    const add = (label: string | null | undefined, value: string | null | undefined): void => {
      // Only labels are canonicalized. Values retain whitespace, punctuation, and line breaks.
      if (label !== undefined && label !== null && value !== undefined && value !== null && value.trim() !== "") {
        pairs.push([label.trim(), value]);
      }
    };
    for (const element of body.querySelectorAll<HTMLElement>("[data-field]")) {
      add(element.dataset.field, element.dataset.value ?? element.textContent);
    }
    for (const term of body.querySelectorAll("dt")) {
      if (term.nextElementSibling?.tagName === "DD") add(term.textContent, term.nextElementSibling.textContent);
    }
    for (const row of body.querySelectorAll("tr")) {
      const cells = row.querySelectorAll("th, td");
      if (cells.length >= 2) add(cells[0]?.textContent, cells[1]?.textContent);
    }
    for (const element of body.querySelectorAll<HTMLElement>("[aria-label][data-value]")) {
      add(element.getAttribute("aria-label"), element.dataset.value);
    }

    const candidates = Array.from(body.querySelectorAll(options.renderedFieldLabels));
    // Do not search seller prose for structured fields, even when it includes label-like markup.
    const descriptions = candidates.filter((element) => /^(?:about this listing|description|seller notes)$/i.test(element.textContent.trim()))
      .map((element) => element.nextElementSibling).filter((element) => element !== null);
    for (const element of candidates) {
      if (descriptions.some((description) => description.contains(element))) continue;
      const label = element.textContent;
      if (!known.has(key(label))) continue;
      if (Array.from(element.children).some((child) => key(child.textContent) === key(label))) continue;
      const value = element.nextElementSibling;
      if (value === null || known.has(key(value.textContent))) continue;
      if (value.matches("input, button, form") || value.querySelector("input, button, h1, h2, h3")) continue;
      add(label, value.textContent);
    }

    const schemaFields: readonly [string, string][] = [
      ["address", '[itemprop="streetAddress"]'], ["city", '[itemprop="addressLocality"]'],
      ["state", '[itemprop="addressRegion"]'], ["zipCode", '[itemprop="postalCode"]'],
      ["description", '[itemprop="description"]'], ["purchasePrice", '[itemprop="price"]'],
    ];
    for (const [name, selector] of schemaFields) {
      const element = body.querySelector(selector);
      add(name, element?.getAttribute("content") ?? element?.textContent);
    }
    const heading = body.querySelector("h1");
    if (heading !== null && !pairs.some(([label]) => key(label) === "address")) add("address", heading.textContent);
    for (const element of candidates) {
      if (descriptions.some((description) => description.contains(element))) continue;
      const value = element.textContent;
      if (Array.from(element.children).some((child) => child.textContent === value)) continue;
      if (/^(?:Creative Listing(?:\s*-\s*[^\n]+)?|Cash Listing)$/.test(value.trim())) add("financingType", value);
      if (/^(?:Active|Inactive|Pending|Sold)$/.test(value.trim())) add("sourceStatus", value);
      if (/^[^\n,]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?$/.test(value.trim())) add("locationText", value);
    }
    return pairs;
  }, { labels: Object.entries(FIELD_ALIASES).flatMap(([canonical, aliases]) => [canonical, ...aliases]), renderedFieldLabels: CREATIVE_LISTING_SELECTORS.renderedFieldLabels });

  const fields: Record<string, unknown> = {};
  const valuesByLabel = new Map<string, Set<string>>();
  const sourceValues = new Map<string, Set<string>>();
  for (const [label, value] of rawPairs) {
    const source = sourceValues.get(label) ?? new Set<string>();
    source.add(value);
    sourceValues.set(label, source);
    const values = valuesByLabel.get(normalizeLabel(label)) ?? new Set<string>();
    values.add(value);
    valuesByLabel.set(normalizeLabel(label), values);
  }
  for (const [label, values] of sourceValues) fields[`source.${label}`] = collapse(values);
  for (const [canonical, aliases] of Object.entries({ ...FIELD_ALIASES, locationText: ["locationText"] })) {
    const values = new Set([canonical, ...aliases].flatMap((alias) => [...(valuesByLabel.get(normalizeLabel(alias)) ?? [])]));
    if (values.size > 0) fields[canonical] = collapse(values);
  }
  return { sourceListingId, sourceUrl: new URL(`/deals/${sourceListingId}`, page.url()).toString(), capturedAt, fields };
}

function collapse(values: Set<string>): string | string[] {
  const all = [...values];
  return all.length === 1 ? (all[0] ?? "") : all;
}

export async function findNextPageControl(page: Page): Promise<Locator | undefined> {
  for (const selector of CREATIVE_LISTING_SELECTORS.nextPage) {
    for (const locator of await page.locator(selector).all()) {
      if (!(await locator.isVisible())) continue;
      if (!(await locator.isDisabled()) && await locator.getAttribute("aria-disabled") !== "true") return locator;
    }
  }
  return undefined;
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
