import type { BuyBoxRuleId } from "../config/index.js";
import type { EvaluationStatus, ListingEvaluation, RuleResult } from "../models/index.js";
import type { BuyBoxRule, ListingRuleEngine, RuleEvaluationContext } from "./types.js";

export class MissingRuleImplementationError extends Error {
  public constructor(public readonly missingRuleIds: readonly BuyBoxRuleId[]) {
    super(`No rule implementation registered for required filters: ${missingRuleIds.join(", ")}.`);
    this.name = "MissingRuleImplementationError";
  }
}

export class DeterministicRuleEngine implements ListingRuleEngine {
  private readonly rules: ReadonlyMap<BuyBoxRuleId, BuyBoxRule>;

  public constructor(rules: readonly BuyBoxRule[]) {
    this.rules = new Map(rules.map((rule) => [rule.ruleId, rule]));
  }

  public async evaluate(context: RuleEvaluationContext): Promise<ListingEvaluation> {
    const requiredRuleIds: readonly BuyBoxRuleId[] = ["source", ...context.config.decision.approve_only_if_all_required_filters_pass];
    const enabledRequiredRuleIds = requiredRuleIds.filter(
      (ruleId) => ruleId === "source" || context.config.filters[ruleId].enabled,
    );
    const missingRuleIds = enabledRequiredRuleIds.filter((ruleId) => !this.rules.has(ruleId));
    if (missingRuleIds.length > 0) {
      throw new MissingRuleImplementationError(missingRuleIds);
    }

    const results: RuleResult[] = [];
    for (const ruleId of enabledRequiredRuleIds) {
      const rule = this.rules.get(ruleId);
      if (rule === undefined) {
        throw new MissingRuleImplementationError([ruleId]);
      }
      results.push(...await rule.evaluate(context));
    }

    return {
      evaluationId: context.evaluationId,
      listingId: context.listing.sourceListingId,
      evaluatedAt: context.evaluatedAt,
      rulesVersion: context.rulesVersion,
      finalStatus: aggregateStatus(results),
      results,
      relevantFinancialSnapshot: context.listing.financials,
    };
  }
}

export function aggregateStatus(results: readonly RuleResult[]): EvaluationStatus {
  if (results.some((result) => result.status === "FAIL")) return "REJECT";
  if (results.some((result) => result.status === "VERIFY")) return "NEEDS_VERIFICATION";
  if (results.length === 0 || results.every((result) => result.status === "NOT_APPLICABLE")) return "ERROR";
  return "PASS";
}
