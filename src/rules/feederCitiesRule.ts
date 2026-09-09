import type { FeederCityFacts, RuleResult } from "../models/index.js";
import { compareNumber } from "./comparison.js";
import type { BuyBoxRule, RuleEvaluationContext } from "./types.js";

export class FeederCitiesRule implements BuyBoxRule {
  public readonly ruleId = "feeder_cities" as const;

  public evaluate({ listing, config }: RuleEvaluationContext): readonly RuleResult[] {
    const rule = config.filters.feeder_cities;
    const qualifying = new Map<string, FeederCityFacts>();
    for (const feeder of listing.marketScreening?.feederCities ?? []) {
      if (rule.counting_rules.exclude_subject_property_metro && feeder.isSubjectPropertyMetro !== false) continue;
      if (feeder.metropolitanPopulation === undefined || feeder.drivingTimeMinutes === undefined) continue;
      if (!compareNumber(feeder.metropolitanPopulation, rule.population.operator, rule.population.minimum)) continue;
      if (!compareNumber(feeder.drivingTimeMinutes, rule.driving_time.operator, rule.driving_time.maximum_minutes)) continue;
      if (rule.counting_rules.count_unique_metro_areas_only && feeder.metroAreaId === undefined) continue;
      qualifying.set(rule.counting_rules.count_unique_metro_areas_only ? feeder.metroAreaId ?? "" : feeder.city, feeder);
    }

    const observedValue = [...qualifying.values()];
    const passes = observedValue.length >= rule.minimum_qualifying_cities;
    return [{
      ruleId: "feeder_cities.minimum_qualifying_cities",
      status: passes ? "PASS" : "FAIL",
      reasonCode: passes ? "FEEDER_CITIES_QUALIFIED" : "INSUFFICIENT_FEEDER_CITIES",
      message: passes
        ? "The minimum number of unique qualifying feeder metros was met."
        : `The feeder-city requirement failed; YAML action is ${rule.failed_action}. Missing or ambiguous facts are not counted.`,
      observedValue,
      expectedValue: {
        minimumQualifyingCities: rule.minimum_qualifying_cities,
        maximumDrivingMinutes: rule.driving_time.maximum_minutes,
        minimumMetropolitanPopulation: rule.population.minimum,
      },
    }];
  }
}
