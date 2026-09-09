import type { RuleResult } from "../models/index.js";
import { compareNumber } from "./comparison.js";
import type { BuyBoxRule, RuleEvaluationContext } from "./types.js";

export class FinancingRule implements BuyBoxRule {
  public readonly ruleId = "financing" as const;

  public evaluate({ listing, config }: RuleEvaluationContext): readonly RuleResult[] {
    const rule = config.filters.financing;
    const values = {
      down_payment: listing.financials.downPayment,
      monthly_payment: listing.financials.monthlyPayment,
    };
    const results: RuleResult[] = [];

    for (const field of rule.required_fields) {
      const observed = values[field];
      const expected = field === "down_payment" ? rule.down_payment : rule.monthly_payment;
      if (observed === undefined) {
        results.push({
          ruleId: `financing.${field}`,
          status: "FAIL",
          reasonCode: `MISSING_${field.toUpperCase()}`,
          message: `${field} is required; YAML action is ${rule.missing_required_fields_action}.`,
          expectedValue: expected,
        });
        continue;
      }
      const passes = compareNumber(observed, expected.operator, expected.amount);
      results.push({
        ruleId: `financing.${field}`,
        status: passes ? "PASS" : "FAIL",
        reasonCode: passes ? `${field.toUpperCase()}_PASSED` : `${field.toUpperCase()}_FAILED`,
        message: passes ? `${field} satisfies the configured threshold.` : `${field} failed; YAML action is ${rule.failed_action}.`,
        observedValue: observed,
        expectedValue: expected,
      });
    }
    return results;
  }
}
