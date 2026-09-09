import type { RuleResult } from "../models/index.js";
import { compareNumber } from "./comparison.js";
import type { BuyBoxRule, RuleEvaluationContext } from "./types.js";

export class MarketRule implements BuyBoxRule {
  public readonly ruleId = "market" as const;

  public evaluate({ listing, config }: RuleEvaluationContext): readonly RuleResult[] {
    const facts = listing.marketScreening;
    const rule = config.filters.market;
    const attractionRule = rule.qualifying_demand_driver.pass_if_any[0].attraction;
    const destinationRule = rule.qualifying_demand_driver.pass_if_any[1].destination_city;

    const qualifyingAttraction = facts?.attractions.find((attraction) =>
      attraction.annualVisitors !== undefined
      && attraction.drivingDistanceMinutes !== undefined
      && compareNumber(attraction.annualVisitors, attractionRule.operator, attractionRule.minimum_annual_visitors)
      && attraction.drivingDistanceMinutes <= attractionRule.maximum_driving_distance_minutes);
    const destination = facts?.destinationCity;
    const qualifyingDestination = destination?.cityItselfIsPrimaryAttraction === destinationRule.city_itself_is_primary_attraction
      && destination.annualVisitors !== undefined
      && compareNumber(destination.annualVisitors, destinationRule.operator, destinationRule.minimum_annual_visitors)
      && (!destinationRule.evidence_of_significant_tourism_demand_required || destination.evidenceOfSignificantTourismDemand === true);

    const demandResult: RuleResult = qualifyingAttraction !== undefined
      ? {
          ruleId: "market.qualifying_demand_driver.attraction", status: "PASS", reasonCode: "ATTRACTION_QUALIFIES",
          message: "A nearby attraction satisfies the configured visitor and driving-time thresholds.",
          observedValue: qualifyingAttraction, expectedValue: attractionRule,
        }
      : qualifyingDestination
        ? {
            ruleId: "market.qualifying_demand_driver.destination_city", status: "PASS", reasonCode: "DESTINATION_CITY_QUALIFIES",
            message: "The destination city satisfies the configured tourism-demand requirements.",
            observedValue: destination, expectedValue: destinationRule,
          }
        : {
            ruleId: "market.qualifying_demand_driver", status: "FAIL", reasonCode: "DEMAND_DRIVER_NOT_QUALIFIED",
            message: `No demand driver satisfies the YAML requirements; action is ${rule.failed_demand_driver_action}.`,
            observedValue: facts === undefined ? undefined : { attractions: facts.attractions, destinationCity: facts.destinationCity },
            expectedValue: rule.qualifying_demand_driver,
          };

    if (!rule.military_base.identify_if_present) return [demandResult];
    const nearbyBase = facts?.militaryBases.find((base) =>
      base.drivingDistanceMinutes !== undefined
      && base.drivingDistanceMinutes <= rule.military_base.maximum_driving_distance_minutes);
    const militaryResult: RuleResult = nearbyBase === undefined
      ? { ruleId: "market.military_base", status: "NOT_APPLICABLE", reasonCode: "NO_NEARBY_MILITARY_BASE", message: "No military base was identified within the configured distance." }
      : {
          ruleId: "market.military_base", status: "PASS", reasonCode: "NEARBY_MILITARY_BASE_IDENTIFIED",
          message: "An optional positive military-base factor was identified.", observedValue: nearbyBase,
          expectedValue: { maximumDrivingDistanceMinutes: rule.military_base.maximum_driving_distance_minutes },
        };
    return [demandResult, militaryResult];
  }
}
