import type { BuyBoxConfig, BuyBoxRuleId } from "../config/index.js";
import type { ListingEvaluation, NormalizedListing, RuleResult } from "../models/index.js";

export interface RuleEvaluationContext {
  listing: NormalizedListing;
  config: BuyBoxConfig;
  rulesVersion: string;
  evaluatedAt: string;
  evaluationId: string;
}

export interface BuyBoxRule {
  readonly ruleId: BuyBoxRuleId;
  evaluate(context: RuleEvaluationContext): Promise<readonly RuleResult[]> | readonly RuleResult[];
}

export interface ListingRuleEngine {
  evaluate(context: RuleEvaluationContext): Promise<ListingEvaluation>;
}
