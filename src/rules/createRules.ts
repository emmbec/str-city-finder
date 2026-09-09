import type { BuyBoxRule } from "./types.js";
import { FeederCitiesRule } from "./feederCitiesRule.js";
import { FinancingRule } from "./financingRule.js";
import { MarketRule } from "./marketRule.js";
import { SourceEligibilityRule } from "./sourceRule.js";
import { StrLegalityRule } from "./strLegalityRule.js";

export function createConfiguredRules(): readonly BuyBoxRule[] {
  return [
    new SourceEligibilityRule(),
    new StrLegalityRule(),
    new FinancingRule(),
    new MarketRule(),
    new FeederCitiesRule(),
  ];
}
