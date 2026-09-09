import { describe, expect, it } from "vitest";
import {
  parseBathrooms,
  parseBedrooms,
  parseCurrency,
  parsePropertyType,
  parseSquareFeet,
  parseYearBuilt,
} from "../../src/normalization/index.js";

describe("normalization parsers", () => {
  it.each([
    ["$250,000", 250_000],
    ["USD $1,234.56", 1_234.56],
    ["$2,200 / month", 2_200],
    [3600, 3_600],
  ])("parses currency %p", (raw, expected) => {
    expect(parseCurrency(raw)).toEqual({ success: true, value: expected });
  });

  it.each(["$12k", "1,23", "call for price", -1, Number.NaN])("rejects malformed currency %p", (raw) => {
    expect(parseCurrency(raw)).toEqual(expect.objectContaining({ success: false, code: "MALFORMED" }));
  });

  it.each([["3 beds", 3], ["4 bedrooms", 4], ["3 beds and 2 baths", 3], ["Studio", 0], [2, 2]])("parses bedrooms %p", (raw, expected) => {
    expect(parseBedrooms(raw)).toEqual({ success: true, value: expected });
  });

  it("distinguishes full and half bathrooms", () => {
    expect(parseBathrooms("2 full, 1 half")).toEqual({ success: true, value: { fullBaths: 2, halfBaths: 1 } });
    expect(parseBathrooms("2.5 baths")).toEqual({ success: true, value: { fullBaths: 2, halfBaths: 1 } });
    expect(parseBathrooms("2 baths")).toEqual({ success: true, value: { fullBaths: 2, halfBaths: 0 } });
    expect(parseBathrooms("3 beds and 2 baths")).toEqual({ success: true, value: { fullBaths: 2, halfBaths: 0 } });
  });

  it("rejects unsupported bathroom fractions", () => {
    expect(parseBathrooms("2.75 baths")).toEqual(expect.objectContaining({ success: false, code: "MALFORMED" }));
  });

  it.each([["1,850 sq. ft.", 1850], ["950 square feet", 950], [2200, 2200]])("parses square footage %p", (raw, expected) => {
    expect(parseSquareFeet(raw)).toEqual({ success: true, value: expected });
  });

  it.each([["Built 1998", false], ["1998", true], [2020, true], ["98", false]])("validates year built %p", (raw, valid) => {
    expect(parseYearBuilt(raw).success).toBe(valid);
  });

  it.each([["Single Family", "SINGLE_FAMILY"], ["multi-family", "MULTI_FAMILY"], ["Condo", "CONDO"]])("normalizes property type %p", (raw, expected) => {
    expect(parsePropertyType(raw)).toEqual({ success: true, value: expected });
  });
});
