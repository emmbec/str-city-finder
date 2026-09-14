import { pathToFileURL } from "node:url";
import { AzureKeyVaultSecretProvider } from "../azure/index.js";
import { loadBuyBoxConfig } from "../config/index.js";
import { JsonConsoleLogger } from "../logging/index.js";
import { DefaultListingNormalizer } from "../normalization/index.js";
import { collectNormalizeAndEvaluate } from "../orchestration/index.js";
import { createConfiguredRules, DeterministicRuleEngine } from "../rules/index.js";
import {
  CreativeListingSource,
  CollectionIncompleteError,
  FileSessionStateStore,
  KeyVaultCredentialProvider,
  loadCreativeListingScraperConfig,
  RateLimitedError,
} from "../scraper/index.js";

export async function runLocalScraper(): Promise<void> {
  const vaultUrl = requiredEnvironment("AZURE_KEY_VAULT_URL");
  const usernameSecret = requiredEnvironment("CREATIVE_LISTING_USERNAME_SECRET_NAME");
  const passwordSecret = requiredEnvironment("CREATIVE_LISTING_PASSWORD_SECRET_NAME");
  const logger = new JsonConsoleLogger();
  const secrets = new AzureKeyVaultSecretProvider(vaultUrl);
  const credentials = new KeyVaultCredentialProvider(secrets, usernameSecret, passwordSecret);
  const statePath = process.env.CREATIVE_LISTING_STATE_PATH ?? ".local/creative-listing/storage-state.json";
  const source = new CreativeListingSource(
    loadCreativeListingScraperConfig(),
    credentials,
    new FileSessionStateStore(statePath),
    logger,
  );
  const buyBox = await loadBuyBoxConfig();
  const dependencies = {
    source,
    normalizer: new DefaultListingNormalizer(buyBox.config.currency),
    ruleEngine: new DeterministicRuleEngine(createConfiguredRules()),
    logger,
    buyBox,
  };
  const runId = `local-${new Date().toISOString()}`;
  let collected = 0;
  for await (const result of collectNormalizeAndEvaluate(dependencies, runId)) {
    collected += 1;
    console.info(JSON.stringify({
      event: "local_listing_result",
      listingId: result.normalized.sourceListingId,
      sourceUrl: result.normalized.sourceUrl,
      evaluationStatus: result.evaluation.finalStatus,
      parsingIssueCount: result.normalized.parsingIssues.length,
    }));
  }
  console.info(JSON.stringify({ event: "local_scrape_complete", runId, listingsCollected: collected }));
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) throw new Error(`Required environment setting '${name}' is missing.`);
  return value;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalScraper().catch((error: unknown) => {
    console.error(JSON.stringify({ event: "local_scrape_failed", errorCode: error instanceof RateLimitedError || error instanceof CollectionIncompleteError ? error.code : error instanceof Error ? error.name : "UnknownError",
      ...(error instanceof RateLimitedError ? { retryAfter: error.retryAfter } : {}),
      ...(error instanceof CollectionIncompleteError ? { failedListings: error.failedListings } : {}),
    }));
    process.exitCode = 1;
  });
}
