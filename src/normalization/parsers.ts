export type ParseResult<T> =
  | { success: true; value: T }
  | { success: false; code: "MISSING" | "MALFORMED" | "AMBIGUOUS"; message: string };

const missing = <T>(field: string): ParseResult<T> => ({
  success: false,
  code: "MISSING",
  message: `${field} is missing.`,
});

const malformed = <T>(field: string, value: unknown): ParseResult<T> => ({
  success: false,
  code: "MALFORMED",
  message: `${field} could not be parsed from ${JSON.stringify(value)}.`,
});

export function parseCurrency(value: unknown, field = "currency"): ParseResult<number> {
  if (value === undefined || value === null || value === "") return missing(field);
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? { success: true, value } : malformed(field, value);
  }
  if (typeof value !== "string") return malformed(field, value);

  const trimmed = value.trim();
  const match = /^(?:USD\s*)?\$?\s*((?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.(\d{1,2}))?\s*(?:\/\s*(?:mo(?:nth)?|monthly)|per\s+month)?$/i.exec(trimmed);
  if (match?.[1] === undefined) return malformed(field, value);
  const parsed = Number(`${match[1].replaceAll(",", "")}.${match[2] ?? "0"}`);
  return Number.isFinite(parsed) ? { success: true, value: parsed } : malformed(field, value);
}

export function parsePercentage(value: unknown, field = "percentage"): ParseResult<number> {
  if (value === undefined || value === null || value === "") return missing(field);
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? { success: true, value } : malformed(field, value);
  }
  if (typeof value !== "string") return malformed(field, value);
  const match = /^(\d+(?:\.\d+)?)\s*%?$/.exec(value.trim());
  return match?.[1] === undefined ? malformed(field, value) : { success: true, value: Number(match[1]) };
}

export function parseBedrooms(value: unknown): ParseResult<number> {
  if (value === undefined || value === null || value === "") return missing("beds");
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? { success: true, value } : malformed("beds", value);
  }
  if (typeof value !== "string") return malformed("beds", value);
  if (/^studio$/i.test(value.trim())) return { success: true, value: 0 };
  const match = /^(\d+)\s*(?:beds?|bedrooms?)?(?:\s+and\s+\d+(?:\.5)?\s*(?:baths?|bathrooms?))?$/i.exec(value.trim());
  return match?.[1] === undefined ? malformed("beds", value) : { success: true, value: Number(match[1]) };
}

export interface BathroomCount {
  fullBaths: number;
  halfBaths: number;
}

export function parseBathrooms(value: unknown): ParseResult<BathroomCount> {
  if (value === undefined || value === null || value === "") return missing("bathrooms");
  if (typeof value === "number") return parseNumericBathrooms(value, value);
  if (typeof value !== "string") return malformed("bathrooms", value);

  const trimmed = value.trim();
  const detailed = /^(\d+)\s*full(?:\s*baths?)?\s*[,/&+]\s*(\d+)\s*half(?:\s*baths?)?$/i.exec(trimmed);
  if (detailed?.[1] !== undefined && detailed[2] !== undefined) {
    return { success: true, value: { fullBaths: Number(detailed[1]), halfBaths: Number(detailed[2]) } };
  }
  const numeric = /^(?:\d+\s*(?:beds?|bedrooms?)\s+and\s+)?(\d+(?:\.5)?)\s*(?:baths?|bathrooms?)?$/i.exec(trimmed);
  return numeric?.[1] === undefined ? malformed("bathrooms", value) : parseNumericBathrooms(Number(numeric[1]), value);
}

function parseNumericBathrooms(value: number, rawValue: unknown): ParseResult<BathroomCount> {
  if (!Number.isFinite(value) || value < 0 || (value * 2) % 1 !== 0) return malformed("bathrooms", rawValue);
  return {
    success: true,
    value: { fullBaths: Math.floor(value), halfBaths: value % 1 === 0.5 ? 1 : 0 },
  };
}

export function parseIntegerField(value: unknown, field: string, suffix?: RegExp): ParseResult<number> {
  if (value === undefined || value === null || value === "") return missing(field);
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? { success: true, value } : malformed(field, value);
  }
  if (typeof value !== "string") return malformed(field, value);
  const pattern = suffix === undefined ? /^(\d+)$/ : new RegExp(`^((?:\\d{1,3}(?:,\\d{3})+)|\\d+)\\s*(?:${suffix.source})?$`, "i");
  const match = pattern.exec(value.trim());
  if (match?.[1] === undefined) return malformed(field, value);
  return { success: true, value: Number(match[1].replaceAll(",", "")) };
}

export function parseSquareFeet(value: unknown): ParseResult<number> {
  return parseIntegerField(value, "squareFeet", /sq\.?\s*ft\.?|square\s+feet/);
}

export function parseYearBuilt(value: unknown): ParseResult<number> {
  const parsed = parseIntegerField(value, "yearBuilt");
  if (!parsed.success) return parsed;
  return /^\d{4}$/.test(String(parsed.value)) ? parsed : malformed("yearBuilt", value);
}

export function parsePropertyType(value: unknown): ParseResult<string> {
  if (value === undefined || value === null || value === "") return missing("propertyType");
  if (typeof value !== "string") return malformed("propertyType", value);
  const normalized = value.trim().toLowerCase().replaceAll(/[\s-]+/g, "_");
  return normalized.length === 0 ? malformed("propertyType", value) : { success: true, value: normalized.toUpperCase() };
}
