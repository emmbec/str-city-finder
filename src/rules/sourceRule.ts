import type { FinancingType, RuleResult } from "../models/index.js";
import type { BuyBoxRule, RuleEvaluationContext } from "./types.js";

const financingTypeToConfig: Readonly<Record<FinancingType, string>> = {
  SUBJECT_TO: "subject_to",
  SELLER_FINANCING: "seller_financing",
  HYBRID: "hybrid",
  CASH: "cash",
  OTHER: "other",
  UNKNOWN: "unknown",
};

export class SourceEligibilityRule implements BuyBoxRule {
  public readonly ruleId = "source" as const;

  public evaluate({ listing, config }: RuleEvaluationContext): readonly RuleResult[] {
    const status = listing.sourceStatus.toLowerCase();
    const financingType = financingTypeToConfig[listing.financingType];
    const results: RuleResult[] = [];

    results.push(config.source.listing_status.includes(status)
      ? pass("source.listing_status", "SOURCE_STATUS_ALLOWED", status, config.source.listing_status)
      : fail("source.listing_status", "SOURCE_STATUS_NOT_ALLOWED", status, config.source.listing_status));

    if (config.source.exclude_cash_only_listings && listing.financingType === "CASH") {
      results.push(fail("source.cash_only", "CASH_ONLY_EXCLUDED", financingType, false));
    } else {
      results.push(config.source.allowed_financing_types.includes(financingType)
        ? pass("source.financing_type", "FINANCING_TYPE_ALLOWED", financingType, config.source.allowed_financing_types)
        : fail("source.financing_type", "FINANCING_TYPE_NOT_ALLOWED", financingType, config.source.allowed_financing_types));
    }
    return results;
  }
}

function pass(ruleId: string, reasonCode: string, observedValue: unknown, expectedValue: unknown): RuleResult {
  return { ruleId, status: "PASS", reasonCode, message: "Source eligibility requirement passed.", observedValue, expectedValue };
}

function fail(ruleId: string, reasonCode: string, observedValue: unknown, expectedValue: unknown): RuleResult {
  return { ruleId, status: "FAIL", reasonCode, message: "Source eligibility requirement failed.", observedValue, expectedValue };
}
