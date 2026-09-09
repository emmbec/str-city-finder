import { describe, expect, it } from "vitest";
import { loadBuyBoxConfig } from "../../src/config/index.js";
import type { StructuredLogger } from "../../src/logging/index.js";
import type { RawListingSnapshot } from "../../src/models/index.js";
import { DefaultListingNormalizer } from "../../src/normalization/index.js";
import { collectNormalizeAndEvaluate } from "../../src/orchestration/index.js";
import { createConfiguredRules, DeterministicRuleEngine } from "../../src/rules/index.js";

const logger: StructuredLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe("collection pipeline", () => {
  it("feeds raw scraper output through normalization and deterministic evaluation", async () => {
    const raw: RawListingSnapshot = {
      sourceListingId: "CL-PIPELINE",
      sourceUrl: "https://www.creativelisting.com/deals/CL-PIPELINE",
      capturedAt: "2026-09-09T10:00:00.000Z",
      fields: { city: "Augusta", state: "GA", financingType: "seller financing", sourceStatus: "active", downPayment: "$30,000", piti: "$2,500" },
    };
    const source = { async *collect() { yield await Promise.resolve(raw); } };
    const buyBox = await loadBuyBoxConfig();
    const results = [];
    for await (const result of collectNormalizeAndEvaluate({
      source,
      normalizer: new DefaultListingNormalizer(),
      ruleEngine: new DeterministicRuleEngine(createConfiguredRules()),
      logger,
      buyBox,
    }, "pipeline-run", { now: () => "2026-09-09T10:01:00.000Z", createEvaluationId: () => "evaluation-1" })) {
      results.push(result);
    }

    expect(results).toHaveLength(1);
    expect(results[0]?.normalized.financials.downPayment).toBe(30_000);
    expect(results[0]?.evaluation.listingId).toBe("CL-PIPELINE");
    expect(results[0]?.evaluation.rulesVersion).toBe(buyBox.rulesVersion);
  });
});
