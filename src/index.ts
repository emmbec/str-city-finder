import { pathToFileURL } from "node:url";
import { AzureBlobArtifactStore, AzureKeyVaultSecretProvider } from "./azure/index.js";
import { loadBuyBoxConfig } from "./config/index.js";
import { JsonConsoleLogger } from "./logging/index.js";
import { DefaultListingNormalizer } from "./normalization/index.js";
import { collectNormalizeAndEvaluate } from "./orchestration/index.js";
import { createConfiguredRules, DeterministicRuleEngine } from "./rules/index.js";
import { BlobSessionStateStore, CreativeListingSource, KeyVaultCredentialProvider, loadCreativeListingScraperConfig } from "./scraper/index.js";

export async function main(): Promise<void> {
  const loaded = await loadBuyBoxConfig();
  const logger = new JsonConsoleLogger();
  logger.info({ event: "configuration_loaded", rulesVersion: loaded.rulesVersion, configurationName: loaded.config.name });
  const secrets = new AzureKeyVaultSecretProvider(requiredEnvironment("AZURE_KEY_VAULT_URL"));
  const credentials = new KeyVaultCredentialProvider(
    secrets,
    requiredEnvironment("CREATIVE_LISTING_USERNAME_SECRET_NAME"),
    requiredEnvironment("CREATIVE_LISTING_PASSWORD_SECRET_NAME"),
  );
  const sessionBlobs = new AzureBlobArtifactStore(
    requiredEnvironment("AZURE_BLOB_SERVICE_URL"),
    requiredEnvironment("CREATIVE_LISTING_SESSION_BLOB_CONTAINER"),
  );
  const source = new CreativeListingSource(
    loadCreativeListingScraperConfig(),
    credentials,
    new BlobSessionStateStore(sessionBlobs, requiredEnvironment("CREATIVE_LISTING_SESSION_BLOB_NAME")),
    logger,
  );
  const runId = new Date().toISOString();
  let listingsCollected = 0;
  for await (const result of collectNormalizeAndEvaluate({
    source,
    normalizer: new DefaultListingNormalizer(loaded.config.currency),
    ruleEngine: new DeterministicRuleEngine(createConfiguredRules()),
    logger,
    buyBox: loaded,
  }, runId)) {
    listingsCollected += 1;
    logger.info({
      runId,
      listingId: result.normalized.sourceListingId,
      stage: "orchestration",
      event: "listing_pipeline_complete",
      status: result.evaluation.finalStatus,
    });
  }
  logger.info({ runId, stage: "orchestration", event: "collection_complete", status: "success", listingsCollected });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) throw new Error(`Required environment setting '${name}' is missing.`);
  return value;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    console.error(JSON.stringify({ event: "startup_failed", message }));
    process.exitCode = 1;
  });
}
