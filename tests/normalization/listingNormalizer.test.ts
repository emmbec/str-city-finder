import { describe, expect, it } from "vitest";
import type { RawListingSnapshot } from "../../src/models/index.js";
import { DefaultListingNormalizer } from "../../src/normalization/index.js";

function snapshot(fields: Record<string, unknown>): RawListingSnapshot {
  return {
    sourceListingId: "CL100",
    sourceUrl: "https://example.test/CL100",
    capturedAt: "2026-09-09T10:00:00.000Z",
    fields,
  };
}

describe("DefaultListingNormalizer", () => {
  it("normalizes financial and property fields while preserving every raw value", () => {
    const raw = {
      address: " 123 Main St ", city: " Augusta ", state: "ga", zipCode: "30901",
      purchasePrice: "$250,000", entryFee: "$35,000", downPayment: "$35,000",
      piti: "$2,200 / month", beds: "3 beds", bathrooms: "2 full, 1 half",
      squareFeet: "1,850 sq. ft.", yearBuilt: "1998", propertyType: "Single Family",
      financingType: "seller financing", sourceStatus: "active", interestRate: "5.25%",
    };
    const result = new DefaultListingNormalizer().normalize(snapshot(raw));

    expect(result).toEqual(expect.objectContaining({
      address: "123 Main St", city: "Augusta", state: "GA", zipCode: "30901",
      beds: 3, fullBaths: 2, halfBaths: 1, squareFeet: 1850, yearBuilt: 1998,
      propertyType: "SINGLE_FAMILY", financingType: "SELLER_FINANCING", sourceStatus: "ACTIVE",
      confidence: "HIGH", parsingIssues: [], rawFields: raw,
    }));
    expect(result.financials).toEqual({
      currency: "USD", purchasePrice: 250_000, entryFee: 35_000, downPayment: 35_000,
      piti: 2_200, monthlyPayment: 2_200, interestRate: 5.25,
    });
  });

  it("prefers an explicit monthly payment over PITI when both are present", () => {
    const result = new DefaultListingNormalizer().normalize(snapshot({
      piti: "$2,200", monthlyPayment: "$2,500",
    }));
    expect(result.financials).toEqual({ currency: "USD", piti: 2_200, monthlyPayment: 2_500 });
  });

  it("retains malformed raw values and records structured parsing issues", () => {
    const raw = { purchasePrice: "call for price", entryFee: "$12k", beds: "three", squareFeet: "large", yearBuilt: "old" };
    const result = new DefaultListingNormalizer().normalize(snapshot(raw));
    expect(result.rawFields).toEqual(raw);
    expect(result.financials.purchasePrice).toBeUndefined();
    expect(result.financials.entryFee).toBeUndefined();
    expect(result.beds).toBeUndefined();
    expect(result.confidence).toBe("LOW");
    expect(result.parsingIssues.map((issue) => issue.field)).toEqual(expect.arrayContaining([
      "purchasePrice", "entryFee", "beds", "squareFeet", "yearBuilt",
    ]));
  });

  it("does not choose between conflicting bathroom representations", () => {
    const raw = { bathrooms: "2.5 baths", fullBaths: "3", halfBaths: "0" };
    const result = new DefaultListingNormalizer().normalize(snapshot(raw));
    expect(result.fullBaths).toBeUndefined();
    expect(result.halfBaths).toBeUndefined();
    expect(result.rawFields).toEqual(raw);
    expect(result.parsingIssues).toContainEqual(expect.objectContaining({ field: "bathrooms", code: "AMBIGUOUS" }));
  });
});
