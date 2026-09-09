import type { RuleResult } from "../models/index.js";
import type { BuyBoxRule, RuleEvaluationContext } from "./types.js";

export class StrLegalityRule implements BuyBoxRule {
  public readonly ruleId = "str_legality" as const;

  public evaluate({ listing, config }: RuleEvaluationContext): readonly RuleResult[] {
    const facts = listing.strLegality;
    const rule = config.filters.str_legality;
    if (facts === undefined) return [verify("STR_LEGALITY_MISSING", "STR legality facts are missing.")];

    if (rule.reject_when.explicit_str_prohibition_confirmed && facts.explicitStrProhibitionConfirmed === true) {
      const excludedSources = new Set(rule.evidence.do_not_reject_based_only_on);
      const onlyExcludedEvidence = facts.evidenceSourceTypes.length > 0
        && facts.evidenceSourceTypes.every((source) => excludedSources.has(source));
      if (facts.evidenceSourceTypes.length === 0 || onlyExcludedEvidence) {
        return [verify("STR_PROHIBITION_NEEDS_AUTHORITATIVE_EVIDENCE", "A prohibition cannot be rejected on missing or explicitly excluded evidence alone.")];
      }
      return [{
        ruleId: "str_legality.explicit_prohibition",
        status: "FAIL",
        reasonCode: "STR_PROHIBITION_CONFIRMED",
        message: `An explicit STR prohibition is confirmed; YAML action is ${rule.rejected_action}.`,
        observedValue: facts.evidenceSourceTypes,
        expectedValue: rule.evidence.prefer_authoritative_sources,
      }];
    }

    const continuationConditions = new Map<string, boolean>();
    for (const condition of rule.continue_when.pass_if_any) {
      for (const [name, enabled] of Object.entries(condition)) continuationConditions.set(name, enabled);
    }
    if (continuationConditions.get("str_is_allowed") === true && facts.strIsAllowed === true) {
      return [{ ruleId: "str_legality.allowed", status: "PASS", reasonCode: "STR_ALLOWED", message: "STR use is reported as allowed." }];
    }

    const verificationReasons = [
      [continuationConditions.get("permit_or_registration_required") === true && facts.permitOrRegistrationRequired === true, "STR_PERMIT_OR_REGISTRATION_REQUIRED"],
      [continuationConditions.get("legality_is_uncertain") === true && facts.legalityIsUncertain === true, "STR_LEGALITY_UNCERTAIN"],
      [continuationConditions.get("property_specific_verification_required") === true && facts.propertySpecificVerificationRequired === true, "STR_PROPERTY_VERIFICATION_REQUIRED"],
      [continuationConditions.get("zoning_specific_verification_required") === true && facts.zoningSpecificVerificationRequired === true, "STR_ZONING_VERIFICATION_REQUIRED"],
    ] as const;
    const reason = verificationReasons.find(([active]) => active)?.[1];
    return reason === undefined
      ? [verify("STR_LEGALITY_INCONCLUSIVE", "No configured STR legality continuation condition was established.")]
      : [verify(reason, "The configured legality condition requires verification before final approval.")];
  }
}

function verify(reasonCode: string, message: string): RuleResult {
  return { ruleId: "str_legality", status: "VERIFY", reasonCode, message };
}
