import type { LoadedBuyBoxConfig } from "../config/index.js";
import type { RepositorySet } from "../azure/index.js";
import type { StructuredLogger } from "../logging/index.js";
import type { ListingNormalizer } from "../normalization/index.js";
import type { ListingRuleEngine } from "../rules/index.js";
import type { ListingSource } from "../scraper/index.js";
import type { ListingEvaluation, NormalizedListing, RawListingSnapshot } from "../models/index.js";

export interface CollectionPipelineDependencies {
  source: ListingSource;
  normalizer: ListingNormalizer;
  ruleEngine: ListingRuleEngine;
  logger: StructuredLogger;
  buyBox: LoadedBuyBoxConfig;
}

export interface RunDependencies extends CollectionPipelineDependencies {
  repositories: RepositorySet;
}

export interface CollectedListingResult {
  raw: RawListingSnapshot;
  normalized: NormalizedListing;
  evaluation: ListingEvaluation;
}

export interface PipelineRuntime {
  now(): string;
  createEvaluationId(): string;
}
