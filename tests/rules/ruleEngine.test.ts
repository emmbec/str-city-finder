import { beforeAll, describe, expect, it } from "vitest";
import type { LoadedBuyBoxConfig } from "../../src/config/index.js";
import { loadBuyBoxConfig } from "../../src/config/index.js";
import type { NormalizedListing, RuleResult } from "../../src/models/index.js";
import {
  aggregateStatus,
  createConfiguredRules,
  DeterministicRuleEngine,
  MissingRuleImplementationError,
} from "../../src/rules/index.js";

let loaded: LoadedBuyBoxConfig;

beforeAll(async () => {
  loaded = await loadBuyBoxConfig("config/buybox.yaml");
});

function qualifyingListing(overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    sourceListingId: "CL123",
    sourceUrl: "https://example.test/listing/CL123",
    city: "Augusta",
    state: "GA",
    propertyType: "SINGLE_FAMILY",
    financingType: "SUBJECT_TO",
    financials: { currency: "USD", downPayment: 39_999, monthlyPayment: 3_600 },
    sourceStatus: "ACTIVE",
    confidence: "HIGH",
    parsingIssues: [],
    rawFields: {},
    strLegality: { strIsAllowed: true, evidenceSourceTypes: ["city_government"] },
    marketScreening: {
      attractions: [{ name: "Popular attraction", annualVisitors: 500_000, drivingDistanceMinutes: 30 }],
      militaryBases: [],
      feederCities: [
        { city: "A", metroAreaId: "A-METRO", metropolitanPopulation: 650_000, drivingTimeMinutes: 240, isSubjectPropertyMetro: false },
        { city: "B", metroAreaId: "B-METRO", metropolitanPopulation: 700_000, drivingTimeMinutes: 200, isSubjectPropertyMetro: false },
        { city: "C", metroAreaId: "C-METRO", metropolitanPopulation: 800_000, drivingTimeMinutes: 180, isSubjectPropertyMetro: false },
      ],
    },
    ...overrides,
  };
}

async function evaluate(listing: NormalizedListing) {
  return new DeterministicRuleEngine(createConfiguredRules()).evaluate({
    listing,
    config: loaded.config,
    rulesVersion: loaded.rulesVersion,
    evaluatedAt: "2026-09-09T12:00:00.000Z",
    evaluationId: "eval-1",
  });
}

function getMarketScreening(listing: NormalizedListing): NonNullable<NormalizedListing["marketScreening"]> {
  if (listing.marketScreening === undefined) throw new Error("Test fixture is missing market screening facts.");
  return listing.marketScreening;
}

describe("DeterministicRuleEngine", () => {
  it("fails closed when required YAML rules are not registered", async () => {
    await expect(new DeterministicRuleEngine([]).evaluate({
      listing: qualifyingListing(), config: loaded.config, rulesVersion: loaded.rulesVersion,
      evaluatedAt: "2026-09-09T12:00:00.000Z", evaluationId: "eval-1",
    })).rejects.toBeInstanceOf(MissingRuleImplementationError);
  });

  it("passes exact inclusive YAML boundaries without filtering disabled property characteristics", async () => {
    const evaluation = await evaluate(qualifyingListing({ beds: 0, squareFeet: 100, yearBuilt: 1800 }));
    expect(evaluation.finalStatus).toBe("PASS");
    expect(evaluation.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: "financing.monthly_payment", status: "PASS", observedValue: 3_600 }),
      expect.objectContaining({ ruleId: "market.qualifying_demand_driver.attraction", status: "PASS" }),
      expect.objectContaining({ ruleId: "feeder_cities.minimum_qualifying_cities", status: "PASS" }),
    ]));
  });

  it("rejects a down payment exactly at the exclusive threshold", async () => {
    const listing = qualifyingListing();
    listing.financials = { ...listing.financials, downPayment: 40_000 };
    const evaluation = await evaluate(listing);
    expect(evaluation.finalStatus).toBe("REJECT");
    expect(evaluation.results).toContainEqual(expect.objectContaining({
      ruleId: "financing.down_payment", status: "FAIL", reasonCode: "DOWN_PAYMENT_FAILED",
    }));
  });

  it("rejects a monthly payment above its inclusive maximum", async () => {
    const listing = qualifyingListing();
    listing.financials = { ...listing.financials, monthlyPayment: 3_600.01 };
    const evaluation = await evaluate(listing);
    expect(evaluation.finalStatus).toBe("REJECT");
    expect(evaluation.results).toContainEqual(expect.objectContaining({
      ruleId: "financing.monthly_payment", status: "FAIL", reasonCode: "MONTHLY_PAYMENT_FAILED",
    }));
  });

  it("rejects missing required financial information using the YAML action", async () => {
    const listing = qualifyingListing();
    listing.financials = { currency: "USD", downPayment: 20_000 };
    const evaluation = await evaluate(listing);
    expect(evaluation.finalStatus).toBe("REJECT");
    expect(evaluation.results).toContainEqual(expect.objectContaining({
      ruleId: "financing.monthly_payment", status: "FAIL", reasonCode: "MISSING_MONTHLY_PAYMENT",
    }));
  });

  it("rejects source statuses and financing types excluded by YAML", async () => {
    const evaluation = await evaluate(qualifyingListing({ sourceStatus: "INACTIVE", financingType: "CASH" }));
    expect(evaluation.finalStatus).toBe("REJECT");
    expect(evaluation.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ reasonCode: "SOURCE_STATUS_NOT_ALLOWED" }),
      expect.objectContaining({ reasonCode: "CASH_ONLY_EXCLUDED" }),
    ]));
  });

  it("rejects an explicit prohibition supported by non-excluded evidence", async () => {
    const evaluation = await evaluate(qualifyingListing({
      strLegality: { explicitStrProhibitionConfirmed: true, evidenceSourceTypes: ["municipal_code"] },
    }));
    expect(evaluation.finalStatus).toBe("REJECT");
    expect(evaluation.results).toContainEqual(expect.objectContaining({ reasonCode: "STR_PROHIBITION_CONFIRMED" }));
  });

  it("requires verification when prohibition evidence is only a YAML-excluded source", async () => {
    const evaluation = await evaluate(qualifyingListing({
      strLegality: { explicitStrProhibitionConfirmed: true, evidenceSourceTypes: ["blogs"] },
    }));
    expect(evaluation.finalStatus).toBe("NEEDS_VERIFICATION");
    expect(evaluation.results).toContainEqual(expect.objectContaining({ reasonCode: "STR_PROHIBITION_NEEDS_AUTHORITATIVE_EVIDENCE" }));
  });

  it("requires verification for uncertain or missing legality instead of silently passing", async () => {
    const uncertain = await evaluate(qualifyingListing({
      strLegality: { legalityIsUncertain: true, evidenceSourceTypes: [] },
    }));
    const missingListing = qualifyingListing();
    delete missingListing.strLegality;
    const missing = await evaluate(missingListing);
    expect(uncertain.finalStatus).toBe("NEEDS_VERIFICATION");
    expect(missing.finalStatus).toBe("NEEDS_VERIFICATION");
  });

  it("passes a qualifying destination city when no attraction qualifies", async () => {
    const listing = qualifyingListing();
    listing.marketScreening = {
      ...getMarketScreening(listing),
      attractions: [],
      destinationCity: {
        cityItselfIsPrimaryAttraction: true,
        annualVisitors: 500_000,
        evidenceOfSignificantTourismDemand: true,
      },
    };
    const evaluation = await evaluate(listing);
    expect(evaluation.finalStatus).toBe("PASS");
    expect(evaluation.results).toContainEqual(expect.objectContaining({ reasonCode: "DESTINATION_CITY_QUALIFIES" }));
  });

  it("rejects missing demand-driver evidence using the YAML failure action", async () => {
    const listing = qualifyingListing();
    listing.marketScreening = { ...getMarketScreening(listing), attractions: [] };
    const evaluation = await evaluate(listing);
    expect(evaluation.finalStatus).toBe("REJECT");
    expect(evaluation.results).toContainEqual(expect.objectContaining({ reasonCode: "DEMAND_DRIVER_NOT_QUALIFIED" }));
  });

  it("does not qualify a destination city without the configured tourism evidence", async () => {
    const listing = qualifyingListing();
    listing.marketScreening = {
      ...getMarketScreening(listing),
      attractions: [],
      destinationCity: { cityItselfIsPrimaryAttraction: true, annualVisitors: 500_000 },
    };
    const evaluation = await evaluate(listing);
    expect(evaluation.finalStatus).toBe("REJECT");
    expect(evaluation.results).toContainEqual(expect.objectContaining({ reasonCode: "DEMAND_DRIVER_NOT_QUALIFIED" }));
  });

  it("identifies the optional military factor at its exact distance boundary", async () => {
    const listing = qualifyingListing();
    listing.marketScreening = {
      ...getMarketScreening(listing),
      militaryBases: [{ name: "Example Base", drivingDistanceMinutes: 60 }],
    };
    const evaluation = await evaluate(listing);
    expect(evaluation.results).toContainEqual(expect.objectContaining({
      ruleId: "market.military_base", status: "PASS", reasonCode: "NEARBY_MILITARY_BASE_IDENTIFIED",
    }));
  });

  it("does not count duplicate, subject-market, or incomplete feeder metros", async () => {
    const listing = qualifyingListing();
    listing.marketScreening = {
      ...getMarketScreening(listing),
      feederCities: [
        { city: "A", metroAreaId: "ONE", metropolitanPopulation: 650_000, drivingTimeMinutes: 240, isSubjectPropertyMetro: false },
        { city: "A suburb", metroAreaId: "ONE", metropolitanPopulation: 900_000, drivingTimeMinutes: 100, isSubjectPropertyMetro: false },
        { city: "Subject", metroAreaId: "TWO", metropolitanPopulation: 900_000, drivingTimeMinutes: 10, isSubjectPropertyMetro: true },
        { city: "Unknown metro", metropolitanPopulation: 900_000, drivingTimeMinutes: 100, isSubjectPropertyMetro: false },
        { city: "Missing population", metroAreaId: "THREE", drivingTimeMinutes: 100, isSubjectPropertyMetro: false },
      ],
    };
    const evaluation = await evaluate(listing);
    expect(evaluation.finalStatus).toBe("REJECT");
    expect(evaluation.results).toContainEqual(expect.objectContaining({ reasonCode: "INSUFFICIENT_FEEDER_CITIES" }));
  });
});

describe("aggregateStatus", () => {
  const result = (status: RuleResult["status"]): RuleResult => ({ ruleId: "test", status, reasonCode: "TEST", message: "test" });
  it("gives hard failures precedence over verification", () => {
    expect(aggregateStatus([result("VERIFY"), result("FAIL")])).toBe("REJECT");
  });
  it("does not treat missing results as a pass", () => {
    expect(aggregateStatus([])).toBe("ERROR");
  });
});
