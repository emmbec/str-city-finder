import type { IsoDateTime, MoneySnapshot } from "./common.js";

export type EvaluationStatus = "PASS" | "REJECT" | "NEEDS_VERIFICATION" | "NEEDS_MARKET_REVIEW" | "ERROR";
export type RuleStatus = "PASS" | "FAIL" | "VERIFY" | "NOT_APPLICABLE";

export interface RuleResult {
  ruleId: string;
  status: RuleStatus;
  reasonCode: string;
  message: string;
  observedValue?: unknown;
  expectedValue?: unknown;
}

export interface ListingEvaluation {
  evaluationId: string;
  listingId: string;
  evaluatedAt: IsoDateTime;
  rulesVersion: string;
  finalStatus: EvaluationStatus;
  results: RuleResult[];
  relevantFinancialSnapshot: MoneySnapshot;
}
