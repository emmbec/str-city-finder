import { z } from "zod";

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const positiveNumber = z.number().finite().nonnegative();
const actionSchema = z.enum(["reject_silently"]);

const comparisonSchema = strictObject({
  operator: z.enum(["less_than", "less_than_or_equal", "greater_than_or_equal"]),
  amount: positiveNumber,
});

const visitorComparisonSchema = strictObject({
  minimum_annual_visitors: positiveNumber,
  operator: z.literal("greater_than_or_equal"),
});

export const buyBoxConfigSchema = strictObject({
  version: z.union([z.string().min(1), z.number().finite()]),
  name: z.string().min(1),
  currency: z.string().length(3),
  source: strictObject({
    website: z.url(),
    listing_status: z.array(z.string().min(1)).min(1),
    allowed_financing_types: z.array(z.string().min(1)).min(1),
    exclude_cash_only_listings: z.boolean(),
  }),
  deduplication: strictObject({
    enabled: z.boolean(),
    identifier: z.string().min(1),
    analyze_previously_reviewed_deals: z.boolean(),
    state_file: z.string().min(1),
  }),
  filters: strictObject({
    str_legality: strictObject({
      enabled: z.boolean(),
      reject_when: strictObject({ explicit_str_prohibition_confirmed: z.boolean() }),
      continue_when: strictObject({
        pass_if_any: z.array(z.record(z.string(), z.boolean())).min(1),
      }),
      evidence: strictObject({
        prefer_authoritative_sources: z.array(z.string().min(1)).min(1),
        do_not_reject_based_only_on: z.array(z.string().min(1)).min(1),
      }),
      rejected_action: actionSchema,
    }),
    financing: strictObject({
      enabled: z.boolean(),
      down_payment: comparisonSchema,
      monthly_payment: comparisonSchema,
      required_fields: z.array(z.enum(["down_payment", "monthly_payment"])).min(1),
      missing_required_fields_action: actionSchema,
      failed_action: actionSchema,
    }),
    market: strictObject({
      enabled: z.boolean(),
      qualifying_demand_driver: strictObject({
        required: z.boolean(),
        pass_if_any: z.tuple([
          strictObject({
            attraction: visitorComparisonSchema.extend({
              maximum_driving_distance_minutes: positiveNumber,
            }),
          }),
          strictObject({
            destination_city: visitorComparisonSchema.extend({
              city_itself_is_primary_attraction: z.boolean(),
              evidence_of_significant_tourism_demand_required: z.boolean(),
            }),
          }),
        ]),
      }),
      military_base: strictObject({
        required: z.boolean(),
        identify_if_present: z.boolean(),
        maximum_driving_distance_minutes: positiveNumber,
        treat_as_positive_factor: z.boolean(),
        include_in_notification: z.boolean(),
      }),
      failed_demand_driver_action: actionSchema,
    }),
    feeder_cities: strictObject({
      enabled: z.boolean(),
      required: z.boolean(),
      minimum_qualifying_cities: z.number().int().nonnegative(),
      driving_time: strictObject({
        maximum_minutes: positiveNumber,
        operator: z.literal("less_than_or_equal"),
        measurement: strictObject({
          origin: z.string().min(1),
          destination: z.string().min(1),
          traffic_assumption: z.string().min(1),
        }),
      }),
      population: strictObject({
        geography: z.string().min(1),
        minimum: positiveNumber,
        operator: z.literal("greater_than_or_equal"),
        use_latest_reliable_estimate: z.boolean(),
      }),
      counting_rules: strictObject({
        count_unique_metro_areas_only: z.boolean(),
        exclude_subject_property_metro: z.boolean(),
      }),
      failed_action: actionSchema,
    }),
  }),
  decision: strictObject({
    approve_only_if_all_required_filters_pass: z.array(
      z.enum(["str_legality", "financing", "market", "feeder_cities"]),
    ).min(1),
    possible_results: strictObject({
      approved: z.literal("notify"),
      rejected: z.literal("do_not_notify"),
    }),
  }),
  notification: strictObject({
    notify_only_approved_deals: z.boolean(),
    include_rejected_deals: z.boolean(),
    include_daily_no_match_message: z.boolean(),
    required_fields: z.array(z.string().min(1)).min(1),
    feeder_city_details: z.array(z.string().min(1)).min(1),
  }),
  property_characteristics: strictObject({
    filter_by_purchase_price: z.boolean(),
    filter_by_bedrooms: z.boolean(),
    filter_by_bathrooms: z.boolean(),
    filter_by_square_feet: z.boolean(),
    filter_by_property_condition: z.boolean(),
    filter_by_hoa: z.boolean(),
  }),
});

export type BuyBoxConfig = z.infer<typeof buyBoxConfigSchema>;
export type BuyBoxRuleId = BuyBoxConfig["decision"]["approve_only_if_all_required_filters_pass"][number];
