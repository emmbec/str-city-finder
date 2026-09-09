import type { LoadedBuyBoxConfig } from "../config/index.js";
import type { RepositorySet } from "../azure/index.js";
import type { StructuredLogger } from "../logging/index.js";
import type { ListingNormalizer } from "../normalization/index.js";
import type { ListingRuleEngine } from "../rules/index.js";
import type { ListingSource } from "../scraper/index.js";

export interface RunDependencies {
  source: ListingSource;
  normalizer: ListingNormalizer;
  ruleEngine: ListingRuleEngine;
  repositories: RepositorySet;
  logger: StructuredLogger;
  buyBox: LoadedBuyBoxConfig;
}

// Phase 1 defines dependency boundaries only. Run coordination is deferred until
// collection and normalization are implemented.
