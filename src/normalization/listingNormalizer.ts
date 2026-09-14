import type { FinancingType, NormalizedListing, ParsingIssue, RawListingSnapshot } from "../models/index.js";
import type { ListingNormalizer } from "./types.js";
import {
  parseBathrooms,
  parseBedrooms,
  parseCurrency,
  parseIntegerField,
  parsePercentage,
  parsePropertyType,
  parseSquareFeet,
  parseYearBuilt,
  type ParseResult,
} from "./parsers.js";

export class DefaultListingNormalizer implements ListingNormalizer {
  public constructor(private readonly currency = "USD") {}

  public normalize(snapshot: RawListingSnapshot): NormalizedListing {
    const raw = snapshot.fields;
    const issues: ParsingIssue[] = [];
    const financials: NormalizedListing["financials"] = { currency: this.currency };
    const result: NormalizedListing = {
      sourceListingId: snapshot.sourceListingId,
      sourceUrl: snapshot.sourceUrl,
      financials,
      financingType: normalizeFinancingType(raw.financingType),
      sourceStatus: normalizeSourceStatus(raw.sourceStatus),
      confidence: "HIGH",
      parsingIssues: issues,
      rawFields: { ...raw },
    };

    if (typeof raw.address !== "string" || raw.address.trim().toLowerCase() !== "address undisclosed") {
      assignString(raw.address, "address", result, issues);
    }
    assignString(raw.city, "city", result, issues);
    assignString(raw.state, "state", result, issues, (value) => value.toUpperCase());
    assignString(raw.zipCode, "zipCode", result, issues);
    if (typeof raw.locationText === "string") {
      const location = /^([^\n,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(raw.locationText.trim());
      if (location?.[1] !== undefined && location[2] !== undefined && location[3] !== undefined) {
        result.city ??= location[1].trim();
        result.state ??= location[2];
        result.zipCode ??= location[3];
      } else {
        issues.push({ field: "locationText", rawValue: raw.locationText, code: "MALFORMED", message: "Location text could not be parsed as city, state and ZIP." });
      }
    }
    assignString(raw.description, "description", result, issues);
    assignString(raw.occupancyStatus, "occupancyStatus", result, issues);
    assignDate(raw.sourcePostedAt, result, issues);
    assignParsed(parsePropertyType(raw.propertyType), raw.propertyType, "propertyType", result, issues);
    assignParsed(parseBedrooms(raw.beds), raw.beds, "beds", result, issues);
    assignParsed(parseSquareFeet(raw.squareFeet), raw.squareFeet, "squareFeet", result, issues);
    assignParsed(parseYearBuilt(raw.yearBuilt), raw.yearBuilt, "yearBuilt", result, issues);

    const bathrooms = parseBathrooms(raw.bathrooms);
    const hasSeparateBathrooms = raw.fullBaths !== undefined || raw.halfBaths !== undefined;
    if (bathrooms.success && hasSeparateBathrooms) {
      const full = raw.fullBaths === undefined ? undefined : parseIntegerField(raw.fullBaths, "fullBaths");
      const half = raw.halfBaths === undefined ? undefined : parseIntegerField(raw.halfBaths, "halfBaths");
      const conflicts = (full?.success === true && full.value !== bathrooms.value.fullBaths)
        || (half?.success === true && half.value !== bathrooms.value.halfBaths)
        || full?.success === false
        || half?.success === false;
      if (conflicts) {
        issues.push({
          field: "bathrooms",
          rawValue: { bathrooms: raw.bathrooms, fullBaths: raw.fullBaths, halfBaths: raw.halfBaths },
          code: "AMBIGUOUS",
          message: "Combined and separate bathroom values conflict or are malformed.",
        });
      } else {
        result.fullBaths = bathrooms.value.fullBaths;
        result.halfBaths = bathrooms.value.halfBaths;
      }
    } else if (bathrooms.success) {
      result.fullBaths = bathrooms.value.fullBaths;
      result.halfBaths = bathrooms.value.halfBaths;
    } else if (hasSeparateBathrooms) {
      if (bathrooms.code !== "MISSING") addIssue(issues, "bathrooms", raw.bathrooms, bathrooms);
      assignParsed(parseIntegerField(raw.fullBaths, "fullBaths"), raw.fullBaths, "fullBaths", result, issues);
      assignParsed(parseIntegerField(raw.halfBaths, "halfBaths"), raw.halfBaths, "halfBaths", result, issues);
    } else if (bathrooms.code !== "MISSING") {
      addIssue(issues, "bathrooms", raw.bathrooms, bathrooms);
    }

    assignMoney(raw.purchasePrice, "purchasePrice", financials, issues);
    assignMoney(raw.entryFee, "entryFee", financials, issues);
    assignMoney(raw.downPayment, "downPayment", financials, issues);
    assignMoney(raw.loanBalance, "loanBalance", financials, issues);
    assignParsedMoney(parsePercentage(raw.interestRate, "interestRate"), raw.interestRate, "interestRate", financials, issues);
    assignMoney(raw.hoa, "hoa", financials, issues);
    assignMoney(raw.piti, "piti", financials, issues);
    assignMoney(raw.monthlyPayment, "monthlyPayment", financials, issues);

    if (financials.monthlyPayment === undefined && financials.piti !== undefined && raw.monthlyPayment === undefined) {
      financials.monthlyPayment = financials.piti;
    }

    const hasPropertyOrFinancialData = [result.propertyType, result.beds, result.fullBaths, result.halfBaths,
      result.squareFeet, result.yearBuilt, financials.purchasePrice, financials.downPayment, financials.entryFee,
      financials.loanBalance, financials.interestRate, financials.piti, financials.monthlyPayment, financials.hoa]
      .some((value) => value !== undefined);
    if (!hasPropertyOrFinancialData) {
      issues.push({ field: "listing", rawValue: null, code: "INSUFFICIENT_EXTRACTED_DATA", message: "No usable property or financial fields were extracted." });
    }
    result.confidence = issues.length === 0 ? "HIGH" : "LOW";
    return result;
  }
}

function assignDate(rawValue: unknown, target: NormalizedListing, issues: ParsingIssue[]): void {
  if (rawValue === undefined || rawValue === null || rawValue === "") return;
  if (typeof rawValue !== "string") {
    issues.push({ field: "sourcePostedAt", rawValue, code: "MALFORMED", message: "sourcePostedAt must be date text." });
    return;
  }
  const timestamp = Date.parse(rawValue);
  if (Number.isNaN(timestamp)) {
    issues.push({ field: "sourcePostedAt", rawValue, code: "MALFORMED", message: "sourcePostedAt could not be parsed as a date." });
    return;
  }
  target.sourcePostedAt = new Date(timestamp).toISOString();
}

function assignParsedMoney(
  parsed: ParseResult<number>,
  rawValue: unknown,
  field: keyof Omit<NormalizedListing["financials"], "currency">,
  target: NormalizedListing["financials"],
  issues: ParsingIssue[],
): void {
  if (parsed.success) target[field] = parsed.value;
  else if (parsed.code !== "MISSING") addIssue(issues, field, rawValue, parsed);
}

function assignMoney(
  rawValue: unknown,
  field: keyof Omit<NormalizedListing["financials"], "currency">,
  target: NormalizedListing["financials"],
  issues: ParsingIssue[],
): void {
  const parsed = parseCurrency(rawValue, field);
  if (parsed.success) target[field] = parsed.value;
  else if (parsed.code !== "MISSING") addIssue(issues, field, rawValue, parsed);
}

type DirectParsedField = "propertyType" | "beds" | "squareFeet" | "yearBuilt" | "fullBaths" | "halfBaths";

function assignParsed(
  parsed: ParseResult<string | number>,
  rawValue: unknown,
  field: DirectParsedField,
  target: NormalizedListing,
  issues: ParsingIssue[],
): void {
  if (parsed.success) {
    if (field === "propertyType" && typeof parsed.value === "string") target.propertyType = parsed.value;
    else if (field !== "propertyType" && typeof parsed.value === "number") target[field] = parsed.value;
  } else if (parsed.code !== "MISSING") addIssue(issues, field, rawValue, parsed);
}

function assignString(
  rawValue: unknown,
  field: "address" | "city" | "state" | "zipCode" | "description" | "occupancyStatus",
  target: NormalizedListing,
  issues: ParsingIssue[],
  transform: (value: string) => string = (value) => value,
): void {
  if (rawValue === undefined || rawValue === null || rawValue === "") return;
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    issues.push({ field, rawValue, code: "MALFORMED", message: `${field} must be a non-empty string.` });
    return;
  }
  target[field] = transform(rawValue.trim());
}

function addIssue(issues: ParsingIssue[], field: string, rawValue: unknown, parsed: Extract<ParseResult<unknown>, { success: false }>): void {
  issues.push({ field, rawValue, code: parsed.code, message: parsed.message });
}

function normalizeFinancingType(value: unknown): FinancingType {
  if (typeof value !== "string") return "UNKNOWN";
  const normalized = value.trim().toLowerCase().replace(/^creative listing\s*-\s*/, "").replaceAll(/[\s-]+/g, "_");
  if (normalized === "subject_to" || normalized === "subject2") return "SUBJECT_TO";
  if (normalized === "seller_financing" || normalized === "seller_finance") return "SELLER_FINANCING";
  if (normalized === "hybrid") return "HYBRID";
  if (normalized === "cash" || normalized === "cash_only" || normalized === "cash_listing") return "CASH";
  if (normalized.length === 0 || normalized === "creative_listing") return "UNKNOWN";
  return "OTHER";
}

function normalizeSourceStatus(value: unknown): NormalizedListing["sourceStatus"] {
  if (typeof value !== "string") return "UNKNOWN";
  const normalized = value.trim().toUpperCase();
  return normalized === "ACTIVE" || normalized === "INACTIVE" || normalized === "PENDING" || normalized === "SOLD"
    ? normalized
    : "UNKNOWN";
}
