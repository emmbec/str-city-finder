import { describe, expect, it } from "vitest";
import { loadBuyBoxConfig } from "../../src/config/index.js";
import type { NormalizedListing, RuleResult } from "../../src/models/index.js";
import { aggregateStatus, DeterministicRuleEngine, MissingRuleImplementationError, type BuyBoxRule } from "../../src/rules/index.js";

const listing: NormalizedListing = {
  sourceListingId: "CL123",
  sourceUrl: "https://example.test/listing/CL123",
  city: "Augusta",
  state: "GA",
  financingType: "SUBJECT_TO",
  financials: { currency: "USD", downPayment: 20_000, monthlyPayment: 2_800 },
  sourceStatus: "ACTIVE",
  confidence: "HIGH",
  parsingIssues: [],
};

describe("DeterministicRuleEngine", () => {
  it("fails closed when YAML requires rules that have no implementation", async () => {
    const loaded = await loadBuyBoxConfig("config/buybox.yaml");
    const engine = new DeterministicRuleEngine([]);

    await expect(engine.evaluate({
      listing,
      config: loaded.config,
      rulesVersion: loaded.rulesVersion,
      evaluatedAt: "2026-09-09T12:00:00.000Z",
      evaluationId: "eval-1",
    })).rejects.toBeInstanceOf(MissingRuleImplementationError);
  });

  it("preserves rule IDs and reason codes supplied by registered rules", async () => {
    const loaded = await loadBuyBoxConfig("config/buybox.yaml");
    const rules: BuyBoxRule[] = loaded.config.decision.approve_only_if_all_required_filters_pass.map((ruleId) => ({
      ruleId,
      evaluate: (): RuleResult => ({ ruleId, status: "PASS", reasonCode: `${ruleId.toUpperCase()}_PASSED`, message: "Passed." }),
    }));
    const evaluation = await new DeterministicRuleEngine(rules).evaluate({
      listing,
      config: loaded.config,
      rulesVersion: loaded.rulesVersion,
      evaluatedAt: "2026-09-09T12:00:00.000Z",
      evaluationId: "eval-1",
    });

    expect(evaluation.finalStatus).toBe("PASS");
    expect(evaluation.results.map((result) => result.ruleId)).toEqual([
      "str_legality", "financing", "market", "feeder_cities",
    ]);
    expect(evaluation.rulesVersion).toBe(loaded.rulesVersion);
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
