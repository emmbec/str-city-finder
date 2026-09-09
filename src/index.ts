import { pathToFileURL } from "node:url";
import { loadBuyBoxConfig } from "./config/index.js";

export async function main(): Promise<void> {
  const loaded = await loadBuyBoxConfig();
  console.info(JSON.stringify({
    event: "configuration_loaded",
    rulesVersion: loaded.rulesVersion,
    configurationName: loaded.config.name,
  }));
  console.info(JSON.stringify({
    event: "phase_not_implemented",
    stage: "scraper",
    message: "Creative Listing scraping is intentionally deferred beyond Phase 1.",
  }));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown startup error";
    console.error(JSON.stringify({ event: "startup_failed", message }));
    process.exitCode = 1;
  });
}
